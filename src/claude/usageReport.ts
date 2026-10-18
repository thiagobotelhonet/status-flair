// Parses plan usage that Claude Code leaves in its transcripts. Unlike the status line
// input, this format is not documented, so every field is optional and anything
// unexpected is ignored.

export interface ScopedLimit {
  label: string;
  percent: number;
  resetsAt: number;
}

/** Plan limits as of `ts`, from `/usage` output or from the status line. */
export interface LimitsSnapshot {
  ts: number;
  source: 'usage' | 'statusline';
  fiveHour?: { percent: number; resetsAt: number };
  sevenDay?: { percent: number; resetsAt: number };
  scoped: ScopedLimit[];
}

/** A request rejected because a plan limit was reached. */
export interface LimitHit {
  ts: number;
  type: string;
  resetsAt: number;
}

export interface ParsedLine {
  snapshot?: LimitsSnapshot;
  hit?: LimitHit;
  /** Context window size per model id, as `/usage` reports it. */
  contextWindows?: Record<string, number>;
}

export const LINE_MARKERS = ['"usageReport"', '"rate_limit_info"'];

function clampPercent(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : undefined;
}

function toMs(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

function parseLimits(limits: unknown[], ts: number): LimitsSnapshot {
  const snapshot: LimitsSnapshot = { ts, source: 'usage', scoped: [] };
  for (const raw of limits) {
    const l = raw as { kind?: string; percent?: unknown; resets_at?: unknown; scope?: { model?: { display_name?: string } } };
    const percent = clampPercent(l?.percent);
    const resetsAt = toMs(l?.resets_at);
    if (percent === undefined || resetsAt === undefined) {
      continue;
    }
    if (l.kind === 'session') {
      snapshot.fiveHour = { percent, resetsAt };
    } else if (l.kind === 'weekly_all') {
      snapshot.sevenDay = { percent, resetsAt };
    } else if (l.kind === 'weekly_scoped' && l.scope?.model?.display_name) {
      snapshot.scoped.push({ label: l.scope.model.display_name, percent, resetsAt });
    }
  }
  return snapshot;
}

export function parseTranscriptLine(line: string): ParsedLine {
  let entry: any;
  try {
    entry = JSON.parse(line);
  } catch {
    return {};
  }
  const ts = toMs(entry?.timestamp);
  if (ts === undefined) {
    return {};
  }
  const out: ParsedLine = {};
  const limits = entry.usageReport?.rate_limits?.limits;
  if (Array.isArray(limits)) {
    const snapshot = parseLimits(limits, ts);
    if (snapshot.fiveHour || snapshot.sevenDay || snapshot.scoped.length) {
      out.snapshot = snapshot;
    }
  }
  const models = entry.usageReport?.session?.model_usage;
  if (models && typeof models === 'object') {
    for (const [id, m] of Object.entries(models as Record<string, { contextWindow?: unknown }>)) {
      if (typeof m?.contextWindow === 'number' && m.contextWindow > 0) {
        (out.contextWindows ??= {})[id] = m.contextWindow;
      }
    }
  }
  const info = entry.apiErrorParams?.rate_limit_info ?? entry.quotaLimits;
  const resetsAt = toMs(info?.resetsAt);
  if (info?.status === 'rejected' && resetsAt !== undefined) {
    out.hit = { ts, type: String(info.rateLimitType ?? 'unknown'), resetsAt };
  }
  return out;
}

/** Keeps whichever snapshot or hit is newer. */
export function newer<T extends { ts: number }>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return b.ts > a.ts ? b : a;
}

/** Finds complete lines in `buf` that contain one of `markers`, without decoding the rest. */
export function findMarkedLines(buf: Buffer, markers: string[]): string[] {
  const starts = new Set<number>();
  const lines: string[] = [];
  for (const marker of markers) {
    const needle = Buffer.from(marker);
    let at = buf.indexOf(needle);
    while (at !== -1) {
      const start = buf.lastIndexOf(10, at) + 1;
      let end = buf.indexOf(10, at);
      if (end === -1) {
        end = buf.length;
      }
      if (!starts.has(start)) {
        starts.add(start);
        lines.push(buf.toString('utf8', start, end));
      }
      at = buf.indexOf(needle, end);
    }
  }
  return lines;
}
