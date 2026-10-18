import * as path from 'path';
import { ClaudeState, effectiveState, StateRecord, Timeouts } from './stateModel';

export interface InboxEntry {
  record: StateRecord;
  state: ClaudeState;
  /** A finished (or failed) session you have not looked at yet. */
  unread: boolean;
  /** "hub-preditivo / 048-operacao" for a Claude Code worktree, else the folder name. */
  label: string;
  /** The folder to open for this session: the worktree root when it can be told from the path. */
  root: string;
  /** How long the session has been in its current state. */
  forMs: number;
}

const ORDER: Record<ClaudeState, number> = { waiting: 0, error: 1, working: 2, done: 3, idle: 4 };
const WORKTREE = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/;

export function sessionLocation(cwd: string): { label: string; root: string } {
  const clean = cwd.replace(/[\\/]+$/, '');
  const m = WORKTREE.exec(clean);
  if (m) {
    return { label: `${path.basename(m[1])} / ${m[2]}`, root: clean.slice(0, m[0].length) };
  }
  return { label: path.basename(clean) || clean, root: clean };
}

/** Which finished state of each session was already seen: session id → the `since` of that state. */
export type SeenMap = Record<string, number>;

export function isUnread(record: StateRecord, seen: SeenMap): boolean {
  return (record.state === 'done' || record.state === 'error') && seen[record.sessionId] !== (record.since ?? record.ts);
}

/**
 * Sessions worth showing, most urgent first: waiting (longest wait first), errors,
 * working, then finished ones. Finished sessions stay until you look at them
 * (unread), and for `recentDoneMs` after that.
 */
export function inboxEntries(records: StateRecord[], now: number, t: Timeouts, recentDoneMs: number, seen: SeenMap = {}): InboxEntry[] {
  const entries: InboxEntry[] = [];
  for (const record of records) {
    const unread = isUnread(record, seen);
    const state = effectiveState(record, now, { ...t, doneMs: unread ? Infinity : Math.max(t.doneMs, recentDoneMs) });
    if (state === 'idle') {
      continue;
    }
    entries.push({ record, state, unread, ...sessionLocation(record.cwd), forMs: Math.max(0, now - (record.since ?? record.ts)) });
  }
  return entries.sort((a, b) => ORDER[a.state] - ORDER[b.state] || Number(b.unread) - Number(a.unread) || b.forMs - a.forMs);
}

/** Marks the finished state of `records` as seen. */
export function markSeen(seen: SeenMap, records: StateRecord[]): SeenMap {
  const next = { ...seen };
  for (const r of records) {
    if (r.state === 'done' || r.state === 'error') {
      next[r.sessionId] = r.since ?? r.ts;
    }
  }
  return next;
}

export function countByState(entries: InboxEntry[]): Record<ClaudeState, number> {
  const counts: Record<ClaudeState, number> = { idle: 0, working: 0, waiting: 0, done: 0, error: 0 };
  entries.forEach((e) => counts[e.state]++);
  return counts;
}

/** `45s`, `6 min`, `1h 20m`. */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.round(s / 60);
  if (m < 60) {
    return `${m} min`;
  }
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

/** Work and wait time of sessions active in the last 24 hours. */
export function dayTotals(records: StateRecord[], now: number): { workedMs: number; waitedMs: number; sessions: number } {
  const recent = records.filter((r) => now - r.ts <= 24 * 3_600_000);
  return {
    workedMs: recent.reduce((sum, r) => sum + (r.workedMs ?? 0), 0),
    waitedMs: recent.reduce((sum, r) => sum + (r.waitedMs ?? 0), 0),
    sessions: recent.length,
  };
}

/** Decides whether the focused VS Code window is already showing this session. */
export interface FocusInfo {
  focused: boolean;
  folders: string[];
  ts: number;
}
