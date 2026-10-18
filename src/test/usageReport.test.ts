import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { summarize, UsageRecord } from '../claude/usage';
import { findMarkedLines, LINE_MARKERS, parseTranscriptLine } from '../claude/usageReport';

const now = Date.parse('2026-10-18T12:00:00Z');

// Shapes taken from real Claude Code 2.1.301 transcripts.
const usageLine = JSON.stringify({
  type: 'system',
  subtype: 'local_command',
  timestamp: '2026-10-18T11:00:00.000Z',
  usageReport: {
    session: { total_cost_usd: 0.6 },
    rate_limits: {
      limits: [
        { kind: 'session', group: 'session', percent: 41, resets_at: '2026-10-18T16:20:00.474372+00:00', scope: null },
        { kind: 'weekly_all', group: 'weekly', percent: 14, resets_at: '2026-10-20T19:00:00.474392+00:00', scope: null },
        { kind: 'weekly_scoped', group: 'weekly', percent: 9, resets_at: '2026-10-20T19:00:00+00:00', scope: { model: { display_name: 'Fable' } } },
        { kind: 'something_new', percent: 50, resets_at: '2026-10-20T19:00:00+00:00' },
      ],
    },
  },
  commandRun: { command: 'usage', args: '' },
});

const rejectedLine = JSON.stringify({
  type: 'assistant',
  timestamp: '2026-10-18T11:30:00.000Z',
  isApiErrorMessage: true,
  apiErrorParams: { rate_limit_info: { status: 'rejected', resetsAt: Date.parse('2026-10-18T14:00:00Z') / 1000, rateLimitType: 'five_hour' } },
});

describe('parseTranscriptLine', () => {
  it('reads a /usage report', () => {
    const { snapshot } = parseTranscriptLine(usageLine);
    assert.equal(snapshot?.source, 'usage');
    assert.equal(snapshot?.ts, Date.parse('2026-10-18T11:00:00Z'));
    assert.deepEqual(snapshot?.fiveHour, { percent: 41, resetsAt: Date.parse('2026-10-18T16:20:00.474Z') });
    assert.equal(snapshot?.sevenDay?.percent, 14);
    assert.deepEqual(snapshot?.scoped.map((s) => [s.label, s.percent]), [['Fable', 9]]);
  });

  it('reads a rate-limit rejection', () => {
    assert.deepEqual(parseTranscriptLine(rejectedLine).hit, {
      ts: Date.parse('2026-10-18T11:30:00Z'),
      type: 'five_hour',
      resetsAt: Date.parse('2026-10-18T14:00:00Z'),
    });
  });

  it('ignores anything else', () => {
    for (const line of ['garbage', '{}', JSON.stringify({ timestamp: '2026-10-18T11:00:00Z', usageReport: { rate_limits: { limits: 'x' } } })]) {
      assert.deepEqual(parseTranscriptLine(line), {});
    }
    const allowed = JSON.parse(rejectedLine);
    allowed.apiErrorParams.rate_limit_info.status = 'allowed';
    assert.equal(parseTranscriptLine(JSON.stringify(allowed)).hit, undefined);
  });
});

describe('findMarkedLines', () => {
  it('returns only the marked lines, once each', () => {
    const buf = Buffer.from(['{"a":1}', usageLine, '{"b":"ação"}', rejectedLine, ''].join('\n'));
    const lines = findMarkedLines(buf, LINE_MARKERS);
    assert.deepEqual(lines, [usageLine, rejectedLine]);
  });

  it('handles a marked line at the very end without a newline', () => {
    assert.deepEqual(findMarkedLines(Buffer.from(`x\n${usageLine}`), LINE_MARKERS), [usageLine]);
  });
});

describe('summarize with transcript limits', () => {
  const snapshot = parseTranscriptLine(usageLine).snapshot!;
  const statusLineRecord = (ts: number, percent: number): UsageRecord => ({
    sessionId: 's',
    cwd: '/app',
    ts,
    rate_limits: { five_hour: { used_percentage: percent, resets_at: Date.parse('2026-10-18T16:20:00Z') / 1000 } },
  });

  it('uses /usage when it is the newest source', () => {
    const view = summarize([statusLineRecord(snapshot.ts - 1000, 10)], [], now, undefined, { snapshot });
    assert.equal(view.fiveHour?.percent, 41);
    assert.equal(view.limitsSource, 'usage');
    assert.equal(view.scoped.length, 1);
  });

  it('uses the status line when it is newer', () => {
    const view = summarize([statusLineRecord(snapshot.ts + 1000, 55)], [], now, undefined, { snapshot });
    assert.equal(view.fiveHour?.percent, 55);
    assert.equal(view.limitsSource, 'statusline');
    assert.deepEqual(view.scoped, []);
  });

  it('shows a newer rejection as a full window', () => {
    const hit = parseTranscriptLine(rejectedLine).hit!;
    const view = summarize([], [], now, undefined, { snapshot, hit });
    assert.equal(view.limitHit?.type, 'five_hour');
    assert.equal(view.fiveHour?.percent, 100);
  });

  it('forgets a rejection once its window resets', () => {
    const hit = parseTranscriptLine(rejectedLine).hit!;
    assert.equal(summarize([], [], Date.parse('2026-10-18T15:00:00Z'), undefined, { hit }).limitHit, undefined);
  });
});
