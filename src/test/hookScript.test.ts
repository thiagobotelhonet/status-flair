import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';

// Runs the real hook script the way Claude Code does: JSON on stdin.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-flair-hook-'));
const script = path.join(dir, 'hook.js');
fs.copyFileSync(path.join(__dirname, '..', '..', 'resources', 'claude-hook.js'), script);
const stateFile = path.join(dir, 'state', 'abc-123.json');

function send(event: object): string {
  return execFileSync(process.execPath, [script], { input: JSON.stringify(event), encoding: 'utf8' });
}
const read = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const base = { session_id: 'abc-123', cwd: '/app' };

after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('claude-hook.js', () => {
  it('records working, waiting and done', () => {
    assert.equal(send({ ...base, hook_event_name: 'UserPromptSubmit' }), '');
    assert.equal(read().state, 'working');
    send({ ...base, hook_event_name: 'PermissionRequest' });
    assert.equal(read().state, 'waiting');
    send({ ...base, hook_event_name: 'PostToolUse' });
    assert.equal(read().state, 'working');
    send({ ...base, hook_event_name: 'Stop' });
    assert.deepEqual({ state: read().state, cwd: read().cwd }, { state: 'done', cwd: '/app' });
  });

  it('only treats permission-like notifications as waiting', () => {
    send({ ...base, hook_event_name: 'Stop' });
    send({ ...base, hook_event_name: 'Notification', notification_type: 'idle_prompt' });
    assert.equal(read().state, 'done');
    send({ ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt' });
    assert.equal(read().state, 'waiting');
  });

  it('removes the session on SessionEnd', () => {
    send({ ...base, hook_event_name: 'SessionEnd' });
    assert.equal(fs.existsSync(stateFile), false);
  });

  it('exits quietly on garbage input', () => {
    assert.equal(execFileSync(process.execPath, [script], { input: 'not json', encoding: 'utf8' }), '');
  });
});
