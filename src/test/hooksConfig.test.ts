import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addHooks, ClaudeSettings, hasStatusFlairHooks, HOOK_EVENTS, hookCommand, removeHooks } from '../claude/hooksConfig';

const ours = hookCommand('C:\\Users\\me\\.claude\\status-flair\\hook.js');
const theirs = { type: 'command', command: 'C:/tools/other-hook.cmd', timeout: 10 };

const existing: ClaudeSettings = {
  model: 'opus',
  hooks: { Stop: [{ hooks: [theirs] }], SessionStart: [{ hooks: [theirs] }] },
};

describe('hookCommand', () => {
  it('uses forward slashes and quotes the path', () => {
    assert.equal(ours, 'node "C:/Users/me/.claude/status-flair/hook.js"');
  });
});

describe('addHooks', () => {
  it('adds one entry per event and keeps other hooks and settings', () => {
    const next = addHooks(existing, ours);
    assert.equal(next.model, 'opus');
    assert.ok(hasStatusFlairHooks(next));
    for (const event of HOOK_EVENTS) {
      assert.ok(next.hooks?.[event]?.some((g) => g.hooks?.some((h) => h.command === ours)), event);
    }
    assert.deepEqual(next.hooks?.Stop?.[0], { hooks: [theirs] });
    assert.deepEqual(next.hooks?.SessionStart, [{ hooks: [theirs] }]);
  });

  it('is idempotent', () => {
    const once = addHooks(existing, ours);
    assert.deepEqual(addHooks(once, ours), once);
  });

  it('does not mutate its input', () => {
    const copy = JSON.parse(JSON.stringify(existing));
    addHooks(existing, ours);
    assert.deepEqual(existing, copy);
  });
});

describe('removeHooks', () => {
  it('restores the original settings', () => {
    assert.deepEqual(removeHooks(addHooks(existing, ours)), existing);
  });

  it('drops the hooks key when nothing else is left', () => {
    assert.deepEqual(removeHooks(addHooks({}, ours)), {});
  });

  it('keeps our entry out of mixed groups only', () => {
    const mixed: ClaudeSettings = { hooks: { Stop: [{ hooks: [theirs, { type: 'command', command: ours }] }] } };
    assert.deepEqual(removeHooks(mixed), { hooks: { Stop: [{ hooks: [theirs] }] } });
  });
});
