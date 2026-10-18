#!/usr/bin/env node
// Status Flair hook for Claude Code.
// Records each session in ./state/<session>.json next to this script: its state and since when,
// time worked and waited, the last prompt, and what Claude is doing this turn (current action,
// timeline, subagents, files touched) for the Lens panel.
// It never prints anything and always exits 0, so it cannot change what Claude does.
'use strict';

const fs = require('fs');
const path = require('path');

const STATE_BY_EVENT = {
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  PostToolUse: 'working',
  PostToolUseFailure: 'working',
  PermissionRequest: 'waiting',
  Stop: 'done',
  StopFailure: 'error',
};

const WAITING_NOTIFICATIONS = ['permission_prompt', 'elicitation_dialog'];
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const AGENT_TOOLS = ['Agent', 'Task'];

// Gaps longer than this (an interrupted turn, a laptop asleep) are not counted as work or waiting.
const MAX_INTERVAL_MS = 30 * 60 * 1000;
const PROMPT_CHARS = 140;
const TARGET_CHARS = 160;
const MAX_TIMELINE = 40;
const MAX_AGENTS = 20;
const MAX_FILES = 60;

function stateFor(event) {
  const name = event.hook_event_name;
  if (name === 'Notification') {
    const type = event.notification_type;
    if (type) {
      return WAITING_NOTIFICATIONS.includes(type) ? 'waiting' : undefined;
    }
    return /permission/i.test(event.message || '') ? 'waiting' : undefined;
  }
  return STATE_BY_EVENT[name];
}

function oneLine(text, max) {
  if (typeof text !== 'string') {
    return undefined;
  }
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) {
    return undefined;
  }
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

/** What a tool call is about: the file, command, pattern or description. */
function targetOf(tool, input) {
  const i = input || {};
  const pick = (...keys) => {
    for (const k of keys) {
      if (typeof i[k] === 'string' && i[k].trim()) {
        return i[k];
      }
    }
    return undefined;
  };
  if (tool === 'Bash' || tool === 'PowerShell') {
    return oneLine(String(pick('command') || '').split('\n')[0], TARGET_CHARS);
  }
  if (tool === 'Grep' || tool === 'Glob') {
    return oneLine(pick('pattern'), TARGET_CHARS);
  }
  return oneLine(
    pick('file_path', 'notebook_path', 'path', 'url', 'query', 'description', 'skill', 'prompt') ||
      (Array.isArray(i.questions) && i.questions[0] && i.questions[0].question),
    TARGET_CHARS,
  );
}

function readPrevious(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Windows reports a file being deleted or held open by another process as EPERM/EACCES/EBUSY.
const BUSY = ['EEXIST', 'EPERM', 'EACCES', 'EBUSY'];

/** Parallel tool calls fire hooks at the same time; a lock keeps their updates from overwriting each other. */
function withLock(file, fn) {
  const lock = file + '.lock';
  const deadline = Date.now() + 1500;
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lock, 'wx');
      break;
    } catch (err) {
      if (!BUSY.includes(err.code) || Date.now() > deadline) {
        break; // Could not lock: write anyway rather than lose the event.
      }
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 2000) {
          fs.rmSync(lock, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      sleep(10);
    }
  }
  try {
    fn();
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
      fs.rmSync(lock, { force: true });
    }
  }
}

/** Replaces `file` atomically, retrying while a reader (another hook, the extension) holds it open. */
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (!BUSY.includes(err.code) || attempt >= 50) {
        fs.rmSync(tmp, { force: true });
        throw err;
      }
      sleep(10);
    }
  }
}

function update(prev, event, state, now) {
  const name = event.hook_event_name;
  const tool = event.tool_name;
  const id = event.tool_use_id || (tool ? `${tool}:${now}` : undefined);
  const agent = event.agent_type || undefined;

  let workedMs = (prev && prev.workedMs) || 0;
  let waitedMs = (prev && prev.waitedMs) || 0;
  if (prev && typeof prev.ts === 'number') {
    const interval = now - prev.ts;
    if (interval > 0 && interval <= MAX_INTERVAL_MS) {
      if (prev.state === 'working') {
        workedMs += interval;
      } else if (prev.state === 'waiting') {
        waitedMs += interval;
      }
    }
  }

  let turnStart = prev && prev.turnStart;
  let timeline = (prev && prev.timeline) || [];
  let agents = (prev && prev.agents) || [];
  let files = (prev && prev.files) || {};
  let current = prev && prev.current;

  if (name === 'UserPromptSubmit') {
    turnStart = now;
    timeline = [];
    files = {};
    agents = agents.filter((a) => !a.end);
    current = undefined;
  }

  if ((name === 'PreToolUse' || name === 'PermissionRequest') && tool) {
    const entry = { id, tool, target: targetOf(tool, event.tool_input), start: now };
    if (agent) {
      entry.agent = agent;
    }
    const input = event.tool_input || {};
    // Bash describes its command ("Run unit tests"); a subagent call is labeled with its type.
    const note = AGENT_TOOLS.includes(tool) ? oneLine(input.subagent_type, 40) : oneLine(input.description, 80);
    if (note) {
      entry.note = note;
    }
    if (name === 'PreToolUse') {
      timeline = timeline.filter((e) => e.id !== id).concat(entry).slice(-MAX_TIMELINE);
      if (EDIT_TOOLS.includes(tool)) {
        const file = event.tool_input && (event.tool_input.file_path || event.tool_input.notebook_path);
        if (typeof file === 'string' && file) {
          files = { ...files, [file]: (files[file] || 0) + 1 };
          const keys = Object.keys(files);
          if (keys.length > MAX_FILES) {
            delete files[keys[0]];
          }
        }
      }
      if (AGENT_TOOLS.includes(tool)) {
        const input = event.tool_input || {};
        agents = agents
          .filter((a) => a.id !== id)
          .concat({ id, type: input.subagent_type || 'general-purpose', description: oneLine(input.description, 80), start: now })
          .slice(-MAX_AGENTS);
      }
    }
    current = { ...entry, waiting: name === 'PermissionRequest' || undefined };
  }

  if ((name === 'PostToolUse' || name === 'PostToolUseFailure') && tool) {
    const ok = name === 'PostToolUse';
    // Match by id, or the latest open call of the same tool when ids are missing.
    const open = timeline.filter((e) => !e.end && (e.id === id || (!event.tool_use_id && e.tool === tool)));
    const target = open[open.length - 1];
    if (target) {
      timeline = timeline.map((e) => (e === target ? { ...e, end: now, ok } : e));
    }
    agents = agents.map((a) => (a.id === (target ? target.id : id) && !a.end ? { ...a, end: now, ok } : a));
    if (current && (current.id === id || (target && current.id === target.id))) {
      current = undefined;
    }
  }

  if (name === 'Stop' || name === 'StopFailure') {
    current = undefined;
  }

  return {
    sessionId: event.session_id,
    cwd: event.cwd || (prev && prev.cwd) || '',
    state,
    event: name,
    ts: now,
    since: prev && prev.state === state && prev.since ? prev.since : now,
    workedMs,
    waitedMs,
    prompt: oneLine(event.prompt, PROMPT_CHARS) || (prev && prev.prompt) || undefined,
    turnStart,
    current,
    timeline,
    agents,
    files,
  };
}

function run(input) {
  const event = JSON.parse(input);
  const sessionId = String(event.session_id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!sessionId) {
    return;
  }
  event.session_id = sessionId;
  const dir = path.join(__dirname, 'state');
  const file = path.join(dir, sessionId + '.json');

  if (event.hook_event_name === 'SessionEnd') {
    fs.rmSync(file, { force: true });
    return;
  }
  const state = stateFor(event);
  if (!state) {
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  withLock(file, () => {
    writeAtomic(file, JSON.stringify(update(readPrevious(file), event, state, Date.now())));
  });
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    run(input);
  } catch {
    // Never let a status indicator break a Claude session.
  }
  process.exit(0);
});
setTimeout(() => process.exit(0), 3000).unref();
