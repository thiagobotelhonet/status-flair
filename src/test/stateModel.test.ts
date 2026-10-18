import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregate, isInside, StateRecord } from '../claude/stateModel';

const t = { doneMs: 20_000, staleMs: 15 * 60_000 };
const now = 1_000_000_000;
const rec = (state: StateRecord['state'], cwd: string, ageMs = 0, sessionId = 's'): StateRecord => ({
  sessionId,
  cwd,
  state,
  ts: now - ageMs,
});

describe('isInside', () => {
  it('matches the folder and its subfolders, ignoring Windows drive case and slashes', () => {
    assert.ok(isInside('C:\\dev\\app', 'c:\\dev\\app'));
    assert.ok(isInside('c:/dev/app/src', 'C:\\dev\\app\\'));
    assert.ok(!isInside('c:\\dev\\application', 'c:\\dev\\app'));
    assert.ok(!isInside('/home/Me/app', '/home/me/app'));
  });
});

describe('aggregate', () => {
  it('is idle with no sessions in the workspace', () => {
    assert.equal(aggregate([rec('working', '/other')], ['/app'], now, t).state, 'idle');
  });

  it('prefers the most urgent session', () => {
    const records = [rec('done', '/app', 0, 'a'), rec('waiting', '/app', 0, 'b'), rec('working', '/app', 0, 'c')];
    const result = aggregate(records, ['/app'], now, t);
    assert.equal(result.state, 'waiting');
    assert.equal(result.record?.sessionId, 'b');
  });

  it('lets done and error fade back to idle', () => {
    assert.equal(aggregate([rec('done', '/app', 5_000)], ['/app'], now, t).state, 'done');
    assert.equal(aggregate([rec('done', '/app', 30_000)], ['/app'], now, t).state, 'idle');
    assert.equal(aggregate([rec('error', '/app', 30_000)], ['/app'], now, t).state, 'idle');
  });

  it('treats long-silent working sessions as idle', () => {
    assert.equal(aggregate([rec('working', '/app', 16 * 60_000)], ['/app'], now, t).state, 'idle');
  });
});
