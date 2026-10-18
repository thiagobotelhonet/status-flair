import { isInside } from './stateModel';
import { LimitHit, LimitsSnapshot, newer, ScopedLimit } from './usageReport';

export interface LimitWindow {
  used_percentage?: number;
  /** Unix epoch seconds. */
  resets_at?: number;
}

/** What the status line recorder writes for each session. */
export interface UsageRecord {
  sessionId: string;
  cwd: string;
  ts: number;
  model?: { id?: string; display_name?: string };
  rate_limits?: { five_hour?: LimitWindow; seven_day?: LimitWindow };
  context_window?: { used_percentage?: number; context_window_size?: number };
  cost?: { total_cost_usd?: number };
}

export interface Limit {
  percent: number;
  resetsAt: number;
}

export interface UsageView {
  fiveHour?: Limit;
  sevenDay?: Limit;
  /** Weekly limits for specific models, from `/usage`. */
  scoped: ScopedLimit[];
  /** When the plan limits were last reported, and by what. */
  limitsAt?: number;
  limitsSource?: LimitsSnapshot['source'];
  /** A plan limit that is currently blocking requests. */
  limitHit?: LimitHit;
  /** The status line record for this workspace's session, if any. */
  session?: UsageRecord;
}

/** Limits gathered from sources other than the status line records. */
export interface TranscriptLimits {
  snapshot?: LimitsSnapshot;
  hit?: LimitHit;
}

function fromStatusLine(w: LimitWindow | undefined): Limit | undefined {
  if (typeof w?.used_percentage !== 'number' || typeof w.resets_at !== 'number') {
    return undefined;
  }
  return { percent: Math.max(0, Math.min(100, w.used_percentage)), resetsAt: w.resets_at * 1000 };
}

/** Once a window resets, its old percentage no longer applies. */
function current<T extends { resetsAt: number }>(limit: T | undefined, now: number): T | undefined {
  return limit && limit.resetsAt > now ? limit : undefined;
}

/**
 * Plan limits are account-wide, so they come from the newest report of any session:
 * the status line or a `/usage` run, whichever is newer. A newer rejection overrides both.
 * Context and cost come from `sessionId` when known, else the newest session in `folders`.
 */
export function summarize(
  records: UsageRecord[],
  folders: string[],
  now: number,
  sessionId?: string,
  transcript: TranscriptLimits = {},
): UsageView {
  const newest = [...records].sort((a, b) => b.ts - a.ts);
  const withLimits = newest.find((r) => r.rate_limits);
  const session =
    (sessionId && newest.find((r) => r.sessionId === sessionId)) ||
    newest.find((r) => folders.some((f) => isInside(r.cwd, f)));

  const fromRecords: LimitsSnapshot | undefined = withLimits && {
    ts: withLimits.ts,
    source: 'statusline',
    fiveHour: fromStatusLine(withLimits.rate_limits?.five_hour),
    sevenDay: fromStatusLine(withLimits.rate_limits?.seven_day),
    scoped: [],
  };
  const latest = newer(fromRecords, transcript.snapshot);
  const view: UsageView = {
    fiveHour: current(latest?.fiveHour, now),
    sevenDay: current(latest?.sevenDay, now),
    scoped: (latest?.scoped ?? []).filter((l) => l.resetsAt > now),
    limitsAt: latest?.ts,
    limitsSource: latest?.source,
    session: session || undefined,
  };

  const hit = transcript.hit;
  if (hit && hit.resetsAt > now && (!latest || hit.ts >= latest.ts)) {
    view.limitHit = hit;
    const full = { percent: 100, resetsAt: hit.resetsAt };
    if (hit.type === 'five_hour') {
      view.fiveHour = full;
    } else if (hit.type === 'seven_day') {
      view.sevenDay = full;
    }
  }
  return view;
}

const LIMIT_NAMES: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly' };

export function limitName(type: string): string {
  return LIMIT_NAMES[type] ?? 'Usage';
}

export function bar(percent: number, width = 20): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function formatPercent(percent: number): string {
  return `${Math.round(percent)}%`;
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** `14:20` when it is today, otherwise `Fri 21:00`. */
export function formatReset(at: number, now: number, locale?: string): string {
  const time = new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (new Date(at).toDateString() === new Date(now).toDateString()) {
    return time;
  }
  return `${new Date(at).toLocaleDateString(locale, { weekday: 'short' })} ${time}`;
}

export function formatAgo(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}
