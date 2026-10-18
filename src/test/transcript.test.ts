import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encodeProjectPath, formatTokens, prettyModelName, TranscriptAccumulator } from '../claude/transcript';

describe('prettyModelName', () => {
  const cases: [string, string][] = [
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-fable-5-1', 'Fable 5.1'],
    ['claude-sonnet-4-5-20250929', 'Sonnet 4.5'],
    ['claude-sonnet-4-20250514', 'Sonnet 4'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
    ['claude-3-5-sonnet-20241022', 'Sonnet 3.5'],
    ['claude-3-opus-20240229', 'Opus 3'],
    ['claude-opus-4-1[1m]', 'Opus 4.1'],
    ['some-other-model', 'some-other-model'],
  ];
  for (const [id, expected] of cases) {
    it(`${id} → ${expected}`, () => assert.equal(prettyModelName(id), expected));
  }
});

describe('encodeProjectPath', () => {
  it('matches how Claude Code names project folders', () => {
    assert.equal(encodeProjectPath('c:\\desenvolvimento\\pessoal\\status-flair'), 'c--desenvolvimento-pessoal-status-flair');
    assert.equal(encodeProjectPath('/home/me/my app'), '-home-me-my-app');
    assert.equal(encodeProjectPath('C:\\x\\vinculado à empresa'), 'C--x-vinculado---empresa');
  });
});

describe('formatTokens', () => {
  it('abbreviates', () => {
    assert.equal(formatTokens(950), '950');
    assert.equal(formatTokens(1500), '1.5k');
    assert.equal(formatTokens(48_720), '49k');
    assert.equal(formatTokens(1_200_000), '1.2M');
  });
});

function assistant(id: string, usage: object, extra: object = {}): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: 's1',
    timestamp: '2026-10-18T12:00:00Z',
    message: { id, model: 'claude-opus-5-5', usage },
    ...extra,
  });
}

describe('TranscriptAccumulator', () => {
  const usage = { input_tokens: 2, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500, output_tokens: 40 };

  it('sums usage and tracks the latest context size', () => {
    const acc = new TranscriptAccumulator();
    acc.push(assistant('m1', usage) + '\n');
    acc.push(assistant('m2', { ...usage, cache_read_input_tokens: 3000 }) + '\n');
    assert.equal(acc.stats.model, 'claude-opus-5-5');
    assert.equal(acc.stats.contextTokens, 3502);
    assert.equal(acc.stats.outputTokens, 80);
    assert.equal(acc.stats.responses, 2);
    assert.equal(acc.stats.sessionId, 's1');
  });

  it('counts a multi-block response once', () => {
    const acc = new TranscriptAccumulator();
    acc.push([assistant('m1', usage), assistant('m1', usage), ''].join('\n'));
    assert.equal(acc.stats.responses, 1);
    assert.equal(acc.stats.outputTokens, 40);
  });

  it('ignores subagents, synthetic messages and other lines', () => {
    const acc = new TranscriptAccumulator();
    const changed = acc.push(
      [
        assistant('m1', usage, { isSidechain: true }),
        JSON.stringify({ type: 'assistant', message: { id: 'm2', model: '<synthetic>', usage } }),
        JSON.stringify({ type: 'user', message: { content: 'usage' } }),
        'not json "usage"',
        '',
      ].join('\n'),
    );
    assert.equal(changed, false);
    assert.equal(acc.stats.responses, 0);
  });

  it('handles lines split across chunks', () => {
    const acc = new TranscriptAccumulator();
    const line = assistant('m1', usage) + '\n';
    assert.equal(acc.push(line.slice(0, 50)), false);
    assert.equal(acc.push(line.slice(50)), true);
    assert.equal(acc.stats.responses, 1);
  });
});
