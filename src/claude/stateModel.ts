export type ClaudeState = 'idle' | 'working' | 'waiting' | 'done' | 'error';

/** What the hook script writes for each session. */
export interface StateRecord {
  sessionId: string;
  cwd: string;
  state: ClaudeState;
  event?: string;
  /** Last hook event. */
  ts: number;
  /** When the session entered its current state. */
  since?: number;
  /** Time spent working and waiting for the user, across the session. */
  workedMs?: number;
  waitedMs?: number;
  /** Start of the last prompt, on one line. */
  prompt?: string;
  /** When the current turn started. */
  turnStart?: number;
  /** The tool call in progress, or awaiting permission. */
  current?: ActivityEntry & { waiting?: boolean };
  /** Tool calls of the current turn, oldest first. */
  timeline?: ActivityEntry[];
  /** Subagents started this turn, plus any still running from earlier. */
  agents?: AgentEntry[];
  /** Files edited this turn, with the number of edits. */
  files?: Record<string, number>;
}

export interface ActivityEntry {
  id: string;
  tool: string;
  target?: string;
  /** A tool's own description of the call, like Bash's "Run unit tests". */
  note?: string;
  /** Set when a subagent made the call. */
  agent?: string;
  start: number;
  end?: number;
  ok?: boolean;
}

export interface AgentEntry {
  id: string;
  type: string;
  description?: string;
  start: number;
  end?: number;
  ok?: boolean;
}

export interface Timeouts {
  doneMs: number;
  staleMs: number;
}

const PRIORITY: Record<ClaudeState, number> = { waiting: 4, working: 3, error: 2, done: 1, idle: 0 };

export function moreUrgent(a: ClaudeState, b: ClaudeState): ClaudeState {
  return PRIORITY[b] > PRIORITY[a] ? b : a;
}

function normalizePath(p: string): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:/i.test(s) ? s.toLowerCase() : s;
}

export function isInside(cwd: string, folder: string): boolean {
  const c = normalizePath(cwd);
  const f = normalizePath(folder);
  return c === f || c.startsWith(f + '/');
}

/** The state a record shows once its timeouts are applied. */
export function effectiveState(r: StateRecord, now: number, t: Timeouts): ClaudeState {
  const age = now - r.ts;
  if ((r.state === 'done' || r.state === 'error') && age > t.doneMs) {
    return 'idle';
  }
  if ((r.state === 'working' || r.state === 'waiting') && age > t.staleMs) {
    return 'idle';
  }
  return r.state;
}

/**
 * Picks the most urgent state among sessions running inside the given folders,
 * skipping sessions inside `exclude` (e.g. worktrees nested in the folder).
 */
export function aggregate(
  records: StateRecord[],
  folders: string[],
  now: number,
  t: Timeouts,
  exclude: string[] = [],
): { state: ClaudeState; record?: StateRecord } {
  let best: { state: ClaudeState; record?: StateRecord } = { state: 'idle' };
  for (const r of records) {
    if (!folders.some((f) => isInside(r.cwd, f)) || exclude.some((e) => isInside(r.cwd, e))) {
      continue;
    }
    const state = effectiveState(r, now, t);
    const better =
      PRIORITY[state] > PRIORITY[best.state] ||
      (PRIORITY[state] === PRIORITY[best.state] && r.ts > (best.record?.ts ?? 0));
    if (better) {
      best = { state, record: r };
    }
  }
  return best;
}
