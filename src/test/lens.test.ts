import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { inboxEntries, isUnread, markSeen } from '../claude/inboxModel';
import { activityVerb, displayTarget, lensSession, parseNumstat, statusText, toolLabel } from '../claude/lensModel';
import { lensDocument } from '../claude/lensView';
import { StateRecord } from '../claude/stateModel';

const root = path.resolve('/work/app');

describe('hook script: Lens activity', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-flair-lens-'));
  const hook = path.join(dir, 'hook.js');
  fs.copyFileSync(path.join(__dirname, '..', '..', 'resources', 'claude-hook.js'), hook);
  const file = path.join(dir, 'state', 's.json');
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const event = (e: object) => JSON.stringify({ session_id: 's', cwd: root, ...e });
  const send = (e: object) => execFileSync(process.execPath, [hook], { input: event(e) });
  const read = (): StateRecord => JSON.parse(fs.readFileSync(file, 'utf8'));

  it('tracks the current action, the timeline and files of the turn', () => {
    send({ hook_event_name: 'UserPromptSubmit', prompt: 'fix it' });
    send({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: path.join(root, 'src/a.ts') } });
    let r = read();
    assert.equal(r.current?.tool, 'Edit');
    assert.deepEqual(r.files, { [path.join(root, 'src/a.ts')]: 1 });
    send({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'e1' });
    send({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'npm test\nmore', description: 'Run tests' } });
    send({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'b1' });
    r = read();
    assert.equal(r.current, undefined);
    assert.deepEqual(
      r.timeline?.map((e) => [e.tool, e.target?.replace(/\\/g, '/').replace(/^.*\/src/, 'src'), e.note, e.ok]),
      [
        ['Edit', 'src/a.ts', undefined, true],
        ['Bash', 'npm test', 'Run tests', false],
      ],
    );
    assert.ok(r.turnStart && r.turnStart <= Date.now());
  });

  it('flags a call that waits for permission', () => {
    send({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'b2', tool_input: { command: 'rm -rf dist' } });
    send({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_use_id: 'b2', tool_input: { command: 'rm -rf dist' } });
    const r = read();
    assert.equal(r.state, 'waiting');
    assert.deepEqual([r.current?.tool, r.current?.waiting], ['Bash', true]);
  });

  it('tracks subagents and tags their calls', () => {
    send({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'a1', tool_input: { subagent_type: 'Explore', description: 'find code' } });
    send({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_use_id: 'g1', agent_type: 'Explore', tool_input: { pattern: 'foo' } });
    let r = read();
    assert.deepEqual(r.agents?.map((a) => [a.type, a.description, !!a.end]), [['Explore', 'find code', false]]);
    assert.equal(r.timeline?.find((e) => e.id === 'g1')?.agent, 'Explore');
    assert.equal(r.timeline?.find((e) => e.id === 'a1')?.note, 'Explore');
    send({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'a1' });
    r = read();
    assert.equal(r.agents?.[0].ok, true);
  });

  it('starts a fresh turn but keeps running subagents', () => {
    send({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'a2', tool_input: { subagent_type: 'Plan' } });
    send({ hook_event_name: 'UserPromptSubmit', prompt: 'next' });
    const r = read();
    assert.deepEqual([r.timeline, r.files, r.agents?.map((a) => a.type)], [[], {}, ['Plan']]);
    assert.equal(r.prompt, 'next');
  });

  it('keeps every event when hooks run in parallel', async () => {
    send({ hook_event_name: 'UserPromptSubmit', prompt: 'parallel' });
    const runOne = (i: number) =>
      new Promise<void>((resolve) => {
        const child = spawn(process.execPath, [hook]);
        child.on('exit', () => resolve());
        child.stdin.end(event({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: `p${i}`, tool_input: { file_path: `/f${i}` } }));
      });
    await Promise.all(Array.from({ length: 8 }, (_, i) => runOne(i)));
    assert.equal(read().timeline?.length, 8);
    assert.equal(fs.existsSync(file + '.lock'), false);
  });
});

describe('lens model', () => {
  it('names tools and actions', () => {
    assert.equal(toolLabel('mcp__claude_ai_GitHub__get_file_contents'), 'GitHub get_file_contents');
    assert.equal(activityVerb('Grep'), 'Searching');
    assert.equal(activityVerb('Unknown'), 'Unknown');
  });

  it('shows paths relative to the session folder', () => {
    assert.equal(displayTarget({ tool: 'Edit', target: path.join(root, 'src', 'a.ts') }, root), 'src/a.ts');
    assert.equal(displayTarget({ tool: 'Bash', target: 'npm test' }, root), 'npm test');
  });

  it('writes short status bar text', () => {
    assert.equal(statusText({ tool: 'Edit', target: path.join(root, 'src', 'controller.ts') }), 'Editing controller.ts');
    assert.equal(statusText({ tool: 'Bash', target: 'npm test' }), 'Running npm test');
    assert.equal(statusText({ tool: 'Bash', target: 'rm -rf dist', waiting: true }), 'Approve Bash: rm -rf dist');
    assert.ok(statusText({ tool: 'Bash', target: 'x'.repeat(100) }).length <= 34);
    assert.equal(statusText(undefined), '');
  });

  it('builds the session view, newest actions first', () => {
    const r: StateRecord = {
      sessionId: 's',
      cwd: root,
      state: 'working',
      ts: 2,
      since: 1,
      timeline: [
        { id: '1', tool: 'Read', target: path.join(root, 'a.ts'), start: 1, end: 2, ok: true },
        { id: '2', tool: 'Bash', target: 'npm test', start: 3 },
      ],
      files: { [path.join(root, 'a.ts')]: 2 },
    };
    const s = lensSession(r, 'working', [root]);
    assert.equal(s.here, true);
    assert.deepEqual(s.timeline.map((e) => [e.label, e.verb]), [['npm test', 'Running'], ['a.ts', 'Reading']]);
    assert.deepEqual(s.files.map((f) => [f.label, f.edits]), [['a.ts', 2]]);
    assert.equal(lensSession(r, 'working', [path.resolve('/other')]).here, false);
  });

  it('parses numstat', () => {
    const stats = parseNumstat('12\t3\tsrc/a.ts\n-\t-\timg.png\n');
    assert.deepEqual([...stats], [['src/a.ts', { added: 12, removed: 3 }], ['img.png', { added: 0, removed: 0 }]]);
  });

  it('produces a page with a strict content security policy', () => {
    const page = lensDocument('vscode-resource:', 'abc');
    assert.match(page, /default-src 'none'/);
    assert.match(page, /script-src 'nonce-abc'/);
    assert.equal((page.match(/<script nonce="abc">/g) ?? []).length, 1);
  });
});

describe('inbox: finished sessions stay unread', () => {
  const now = 100 * 60_000;
  const t = { doneMs: 20_000, staleMs: 15 * 60_000 };
  const done = (id: string, agoMs: number): StateRecord => ({ sessionId: id, cwd: `/x/${id}`, state: 'done', ts: now - agoMs, since: now - agoMs });

  it('keeps an unread finished session past the recent window', () => {
    const old = done('a', 60 * 60_000);
    assert.equal(isUnread(old, {}), true);
    assert.deepEqual(inboxEntries([old], now, t, 10 * 60_000).map((e) => [e.state, e.unread]), [['done', true]]);
  });

  it('drops it once seen and old, keeps it while recent', () => {
    const old = done('a', 60 * 60_000);
    const recent = done('b', 60_000);
    const seen = markSeen({}, [old, recent]);
    assert.deepEqual(inboxEntries([old, recent], now, t, 10 * 60_000, seen).map((e) => [e.record.sessionId, e.unread]), [['b', false]]);
  });

  it('becomes unread again when the session finishes another turn', () => {
    const first = done('a', 60_000);
    const seen = markSeen({}, [first]);
    assert.equal(isUnread({ ...first, since: now }, seen), true);
  });

  it('lists unread finished sessions before read ones', () => {
    const read = done('r', 30_000);
    const unread = done('u', 60_000);
    const seen = markSeen({}, [read]);
    assert.deepEqual(inboxEntries([read, unread], now, t, 10 * 60_000, seen).map((e) => e.record.sessionId), ['u', 'r']);
  });
});
