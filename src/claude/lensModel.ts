import * as path from 'path';
import { sessionLocation } from './inboxModel';
import { ActivityEntry, AgentEntry, ClaudeState, isInside, StateRecord } from './stateModel';

const VERBS: Record<string, string> = {
  Edit: 'Editing',
  MultiEdit: 'Editing',
  Write: 'Writing',
  NotebookEdit: 'Editing',
  Read: 'Reading',
  Bash: 'Running',
  PowerShell: 'Running',
  Grep: 'Searching',
  Glob: 'Finding',
  WebFetch: 'Fetching',
  WebSearch: 'Searching the web',
  Agent: 'Delegating',
  Task: 'Delegating',
  AskUserQuestion: 'Asking you',
  Skill: 'Using skill',
  ToolSearch: 'Loading tools',
};

/** `mcp__claude_ai_GitHub__get_file_contents` → `GitHub get_file_contents`. */
export function toolLabel(tool: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcp) {
    return `${mcp[1].replace(/^(claude_ai_|plugin_)/, '').replace(/_/g, ' ')} ${mcp[2]}`;
  }
  return tool;
}

export function activityVerb(tool: string): string {
  return VERBS[tool] ?? toolLabel(tool);
}

const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Read']);

/** Paths inside the session's folder are shown relative to it. */
export function displayTarget(entry: Pick<ActivityEntry, 'tool' | 'target'>, root: string): string {
  const t = entry.target ?? '';
  if (FILE_TOOLS.has(entry.tool) && t && isInside(t, root)) {
    return path.relative(root, t).replace(/\\/g, '/');
  }
  return t;
}

/** A few words for the status bar: "Editing controller.ts", "Running npm test". */
export function statusText(entry: (Pick<ActivityEntry, 'tool' | 'target'> & { waiting?: boolean }) | undefined, max = 34): string {
  if (!entry) {
    return '';
  }
  const verb = entry.waiting ? 'Approve' : activityVerb(entry.tool);
  let target = entry.target ?? '';
  if (FILE_TOOLS.has(entry.tool)) {
    target = path.basename(target.replace(/\\/g, '/'));
  }
  const text = entry.waiting ? `${verb} ${toolLabel(entry.tool)}${target ? `: ${target}` : ''}` : `${verb}${target ? ` ${target}` : ''}`;
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

export interface LensFile {
  path: string;
  label: string;
  edits: number;
  added?: number;
  removed?: number;
}

export interface LensSession {
  id: string;
  label: string;
  root: string;
  state: ClaudeState;
  since: number;
  /** The session runs in this window's folder. */
  here: boolean;
  prompt?: string;
  turnStart?: number;
  current?: ActivityEntry & { waiting?: boolean; label: string; verb: string };
  timeline: (ActivityEntry & { label: string; verb: string })[];
  agents: AgentEntry[];
  files: LensFile[];
  workedMs: number;
  waitedMs: number;
  model?: string;
  contextPercent?: number;
}

/** Turns a raw state record into what the Lens panel draws. */
export function lensSession(r: StateRecord, state: ClaudeState, windowFolders: string[]): LensSession {
  const { label, root } = sessionLocation(r.cwd);
  const decorate = (e: ActivityEntry) => ({ ...e, label: displayTarget(e, root), verb: activityVerb(e.tool) });
  return {
    id: r.sessionId,
    label,
    root,
    state,
    since: r.since ?? r.ts,
    here: windowFolders.some((f) => isInside(root, f) && isInside(f, root)),
    prompt: r.prompt,
    turnStart: r.turnStart,
    current: r.current ? { ...decorate(r.current), waiting: r.current.waiting } : undefined,
    timeline: (r.timeline ?? []).map(decorate).reverse(),
    agents: [...(r.agents ?? [])].reverse(),
    files: Object.entries(r.files ?? {}).map(([p, edits]) => ({
      path: p,
      label: isInside(p, root) ? path.relative(root, p).replace(/\\/g, '/') : p,
      edits,
    })),
    workedMs: r.workedMs ?? 0,
    waitedMs: r.waitedMs ?? 0,
  };
}

/** Parses `git diff --numstat` into added/removed lines per path (as git prints them). */
export function parseNumstat(output: string): Map<string, { added: number; removed: number }> {
  const stats = new Map<string, { added: number; removed: number }>();
  for (const line of output.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trim());
    if (m) {
      stats.set(m[3], { added: m[1] === '-' ? 0 : Number(m[1]), removed: m[2] === '-' ? 0 : Number(m[2]) });
    }
  }
  return stats;
}
