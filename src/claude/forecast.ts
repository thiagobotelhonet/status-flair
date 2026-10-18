/** One reading of a usage window, kept to see how fast usage grows. */
export interface UsagePoint {
  ts: number;
  percent: number;
  resetsAt: number;
}

export interface Forecast {
  /** When usage reaches 100% at the current pace, if that happens before the reset. */
  exhaustAt?: number;
  /** Otherwise, the percentage expected at reset. */
  projected?: number;
}

const MAX_POINTS = 300;
const SAME_WINDOW_MS = 5 * 60_000;

function sameWindow(a: number, b: number): boolean {
  return Math.abs(a - b) <= SAME_WINDOW_MS;
}

/** Adds a reading, dropping duplicates and readings from windows that already reset. */
export function addPoint(history: UsagePoint[], point: UsagePoint, now: number): UsagePoint[] {
  const kept = history.filter((p) => p.resetsAt > now && p.ts !== point.ts);
  kept.push(point);
  kept.sort((a, b) => a.ts - b.ts);
  return kept.slice(-MAX_POINTS);
}

/**
 * Projects usage linearly from the readings of the current window. Needs readings
 * spanning at least `minSpanMs` with usage going up; otherwise there is no forecast.
 */
export function forecast(history: UsagePoint[], current: { percent: number; resetsAt: number }, minSpanMs: number): Forecast | undefined {
  const points = history.filter((p) => sameWindow(p.resetsAt, current.resetsAt));
  if (points.length < 2) {
    return undefined;
  }
  const first = points[0];
  const last = points[points.length - 1];
  const span = last.ts - first.ts;
  const rise = last.percent - first.percent;
  if (span < minSpanMs || rise <= 0) {
    return undefined;
  }
  const rate = rise / span;
  const exhaustAt = last.ts + (100 - last.percent) / rate;
  if (exhaustAt < current.resetsAt) {
    return { exhaustAt };
  }
  return { projected: Math.min(100, last.percent + rate * (current.resetsAt - last.ts)) };
}
