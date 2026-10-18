import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bar, formatAgo, formatReset, summarize, UsageRecord } from '../claude/usage';

const now = Date.UTC(2026, 9, 18, 12, 0, 0);
const sec = (ms: number) => Math.round(ms / 1000);

const rec = (over: Partial<UsageRecord>): UsageRecord => ({ sessionId: 's', cwd: '/app', ts: now, ...over });

describe('summarize', () => {
  it('takes plan limits from the newest record of any project', () => {
    const records = [
      rec({ sessionId: 'old', cwd: '/other', ts: now - 60_000, rate_limits: { five_hour: { used_percentage: 10, resets_at: sec(now + 3_600_000) } } }),
      rec({ sessionId: 'new', cwd: '/other', ts: now - 1000, rate_limits: { five_hour: { used_percentage: 41, resets_at: sec(now + 3_600_000) }, seven_day: { used_percentage: 15, resets_at: sec(now + 86_400_000) } } }),
    ];
    const view = summarize(records, ['/app'], now);
    assert.equal(view.fiveHour?.percent, 41);
    assert.equal(view.sevenDay?.percent, 15);
    assert.equal(view.limitsAt, now - 1000);
    assert.equal(view.session, undefined);
  });

  it('drops a window once it has reset', () => {
    const records = [rec({ rate_limits: { five_hour: { used_percentage: 90, resets_at: sec(now - 1000) } } })];
    assert.equal(summarize(records, ['/app'], now).fiveHour, undefined);
  });

  it('ignores records without limits when looking for limits', () => {
    const records = [
      rec({ ts: now - 5000, rate_limits: { five_hour: { used_percentage: 30, resets_at: sec(now + 60_000) } } }),
      rec({ ts: now }),
    ];
    assert.equal(summarize(records, ['/app'], now).fiveHour?.percent, 30);
  });

  it('prefers the transcript session, then the newest one in the workspace', () => {
    const records = [rec({ sessionId: 'a', ts: now - 10 }), rec({ sessionId: 'b', ts: now }), rec({ sessionId: 'c', cwd: '/x', ts: now + 1 })];
    assert.equal(summarize(records, ['/app'], now, 'a').session?.sessionId, 'a');
    assert.equal(summarize(records, ['/app'], now).session?.sessionId, 'b');
  });
});

describe('formatting', () => {
  it('draws bars of fixed width', () => {
    assert.equal(bar(0, 10), '░░░░░░░░░░');
    assert.equal(bar(41, 10), '████░░░░░░');
    assert.equal(bar(150, 10), '██████████');
  });

  it('shows only the time for resets later today', () => {
    const local = new Date(2026, 9, 18, 9, 0).getTime();
    assert.doesNotMatch(formatReset(local + 3_600_000, local, 'en-US'), /[A-Za-z]{3} /);
    assert.match(formatReset(local + 3 * 86_400_000, local, 'en-US'), /^[A-Z][a-z]{2} /);
  });

  it('describes how long ago', () => {
    assert.equal(formatAgo(now - 10_000, now), 'just now');
    assert.equal(formatAgo(now - 5 * 60_000, now), '5 min ago');
    assert.equal(formatAgo(now - 3 * 3_600_000, now), '3 h ago');
  });
});
