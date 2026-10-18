import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { addPoint, forecast, UsagePoint } from '../claude/forecast';
import { countByState, dayTotals, formatDuration, inboxEntries, markSeen, sessionLocation } from '../claude/inboxModel';
import { StateRecord } from '../claude/stateModel';
import { issueNumberFromBranch, prForBranch, PullRequest, summarizeChecks } from '../github/model';
import { cleanupCandidate, Worktree } from '../worktrees/model';

const H = 3_600_000;

describe('hook script: time and prompt tracking', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-flair-hook2-'));
  const script = path.join(dir, 'hook.js');
  fs.copyFileSync(path.join(__dirname, '..', '..', 'resources', 'claude-hook.js'), script);
  const file = path.join(dir, 'state', 's1.json');
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const send = (event: object) => execFileSync(process.execPath, [script], { input: JSON.stringify({ session_id: 's1', cwd: '/app', ...event }) });
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const backdate = (ms: number) => {
    const r = read();
    r.ts -= ms;
    r.since -= ms;
    fs.writeFileSync(file, JSON.stringify(r));
  };

  it('keeps the start of the prompt on one line', () => {
    send({ hook_event_name: 'UserPromptSubmit', prompt: 'fix the\n  login   test ' + 'x'.repeat(300) });
    const r = read();
    assert.ok(r.prompt.startsWith('fix the login test x'));
    assert.ok(r.prompt.length <= 140);
    send({ hook_event_name: 'PreToolUse' });
    assert.ok(read().prompt.startsWith('fix the login'), 'kept across events');
  });

  it('accumulates working and waiting time, and tracks since when', () => {
    backdate(60_000);
    const sinceBefore = read().since;
    send({ hook_event_name: 'PermissionRequest' });
    let r = read();
    assert.ok(r.workedMs >= 60_000, `worked ${r.workedMs}`);
    assert.ok(r.since > sinceBefore, 'state changed, so since moved');
    backdate(30_000);
    send({ hook_event_name: 'PostToolUse' });
    r = read();
    assert.ok(r.waitedMs >= 30_000 && r.waitedMs < 40_000, `waited ${r.waitedMs}`);
  });

  it('ignores long gaps such as an interrupted turn', () => {
    const worked = read().workedMs;
    backdate(2 * H);
    send({ hook_event_name: 'Stop' });
    assert.equal(read().workedMs, worked);
  });
});

describe('inbox', () => {
  const now = 10 * H;
  const t = { doneMs: 20_000, staleMs: 15 * 60_000 };
  const rec = (sessionId: string, cwd: string, state: StateRecord['state'], agoMs: number, extra: Partial<StateRecord> = {}): StateRecord => ({
    sessionId,
    cwd,
    state,
    ts: now - agoMs,
    since: now - agoMs,
    ...extra,
  });

  it('labels Claude Code worktrees and finds their root', () => {
    assert.deepEqual(sessionLocation('C:\\dev\\hub\\.claude\\worktrees\\048-operacao\\src\\app'), {
      label: 'hub / 048-operacao',
      root: 'C:\\dev\\hub\\.claude\\worktrees\\048-operacao',
    });
    assert.deepEqual(sessionLocation('/home/me/loggiq/'), { label: 'loggiq', root: '/home/me/loggiq' });
  });

  it('puts the longest wait first and drops idle and old, already-seen sessions', () => {
    const seenE = markSeen({}, [rec('e', '/x/e', 'done', 20 * 60_000)]);
    const entries = inboxEntries(
      [
        rec('a', '/x/a', 'working', 60_000),
        rec('b', '/x/b', 'waiting', 30_000),
        rec('c', '/x/c', 'waiting', 300_000),
        rec('d', '/x/d', 'done', 5 * 60_000),
        rec('e', '/x/e', 'done', 20 * 60_000),
        rec('f', '/x/f', 'working', 20 * 60_000),
      ],
      now,
      t,
      10 * 60_000,
      seenE,
    );
    assert.deepEqual(entries.map((e) => e.record.sessionId), ['c', 'b', 'a', 'd']);
    assert.deepEqual(countByState(entries), { idle: 0, working: 1, waiting: 2, done: 1, error: 0 });
  });

  it('formats durations', () => {
    assert.equal(formatDuration(45_000), '45s');
    assert.equal(formatDuration(6 * 60_000), '6 min');
    assert.equal(formatDuration(80 * 60_000), '1h 20m');
    assert.equal(formatDuration(2 * H), '2h');
  });

  it('totals the last 24 hours', () => {
    const totals = dayTotals(
      [rec('a', '/a', 'done', H, { workedMs: 1000, waitedMs: 10 }), rec('b', '/b', 'done', 30 * H, { workedMs: 5000 })],
      now + 0,
    );
    assert.deepEqual(totals, { workedMs: 1000, waitedMs: 10, sessions: 1 });
  });
});

describe('forecast', () => {
  const resetsAt = 100 * H;
  const point = (hour: number, percent: number): UsagePoint => ({ ts: hour * H, percent, resetsAt });

  it('predicts when the limit runs out', () => {
    const f = forecast([point(0, 10), point(10, 30)], { percent: 30, resetsAt }, 6 * H);
    assert.equal(f?.exhaustAt, 45 * H);
  });

  it('projects usage at reset when it will not run out', () => {
    const f = forecast([point(0, 10), point(50, 20)], { percent: 20, resetsAt }, 6 * H);
    assert.equal(f?.projected, 30);
  });

  it('needs enough history and rising usage', () => {
    assert.equal(forecast([point(0, 10), point(1, 30)], { percent: 30, resetsAt }, 6 * H), undefined);
    assert.equal(forecast([point(0, 10), point(10, 10)], { percent: 10, resetsAt }, 6 * H), undefined);
    assert.equal(forecast([point(0, 10)], { percent: 10, resetsAt }, 6 * H), undefined);
  });

  it('ignores readings from another window and drops expired ones', () => {
    const other: UsagePoint = { ts: 0, percent: 90, resetsAt: resetsAt + 7 * 24 * H };
    assert.equal(forecast([other, point(10, 30)], { percent: 30, resetsAt }, 6 * H), undefined);
    const history = addPoint([{ ts: 1, percent: 5, resetsAt: 2 }], point(10, 30), 5);
    assert.deepEqual(history, [point(10, 30)]);
  });
});

describe('github model', () => {
  it('finds the issue number in branch names', () => {
    assert.equal(issueNumberFromBranch('feat/056-recuperacao-de-senha'), 56);
    assert.equal(issueNumberFromBranch('docs/048-regras'), 48);
    assert.equal(issueNumberFromBranch('123-quick-fix'), 123);
    assert.equal(issueNumberFromBranch('main'), undefined);
    assert.equal(issueNumberFromBranch('feat/v2-login'), undefined);
    assert.equal(issueNumberFromBranch(undefined), undefined);
  });

  it('summarizes checks, counting only the latest run of each', () => {
    const s = summarizeChecks([
      { __typename: 'CheckRun', workflowName: 'ci', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: '2026-10-16T10:00:00Z' },
      { __typename: 'CheckRun', workflowName: 'ci', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-10-16T11:00:00Z' },
      { __typename: 'CheckRun', workflowName: 'ci', name: 'lint', status: 'COMPLETED', conclusion: 'SKIPPED', startedAt: '2026-10-16T11:00:00Z' },
      { __typename: 'StatusContext', context: 'deploy', state: 'PENDING' },
    ]);
    assert.deepEqual([s.state, s.passing, s.failing, s.pending], ['pending', 2, 0, 1]);
  });

  it('reports failures with their names', () => {
    const s = summarizeChecks([
      { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://x' },
      { __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS' },
    ]);
    assert.equal(s.state, 'failing');
    assert.deepEqual(s.failed, [{ name: 'build', url: 'https://x' }]);
    assert.equal(summarizeChecks(undefined).state, 'none');
  });

  it('prefers the open PR of a branch, else the latest', () => {
    const pr = (number: number, state: PullRequest['state'], headRefName: string): PullRequest => ({ number, state, headRefName, title: '', url: '' });
    const prs = [pr(10, 'CLOSED', 'a'), pr(12, 'OPEN', 'a'), pr(20, 'MERGED', 'b'), pr(15, 'CLOSED', 'b')];
    assert.equal(prForBranch(prs, 'a')?.number, 12);
    assert.equal(prForBranch(prs, 'b')?.number, 20);
    assert.equal(prForBranch(prs, 'c'), undefined);
  });
});

describe('cleanup with pull requests', () => {
  const w: Worktree = { path: '/r/.claude/worktrees/x', branch: 'feat/x', bare: false, locked: false, prunable: false, main: false };
  it('suggests worktrees whose PR was merged, even when git cannot tell (squash merge)', () => {
    const c = cleanupCandidate({ worktree: w, current: false, claude: 'idle', merged: false, gone: true, prMerged: true, ageDays: 0.2 }, 14);
    assert.deepEqual([c?.reasons, c?.suggested], [['pr-merged'], true]);
  });
});
