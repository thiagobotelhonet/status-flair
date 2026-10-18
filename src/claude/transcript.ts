/** Claude Code stores each project's sessions under `projects/<path with every non-alphanumeric char replaced by ->`. */
export function encodeProjectPath(fsPath: string): string {
  return fsPath.replace(/[^a-zA-Z0-9]/g, '-');
}

const MODEL_ID = /^claude-(?:(\d{1,2})(?:-(\d{1,2}))?-)?([a-z]+)(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?:-\d{8})?$/i;

/** `claude-opus-5-5` → `Opus 5.5`, `claude-3-5-sonnet-20241022` → `Sonnet 3.5`. Unknown ids pass through. */
export function prettyModelName(id: string): string {
  const clean = id.replace(/\[.*\]$/, '');
  const m = MODEL_ID.exec(clean);
  if (!m) {
    return id;
  }
  const [, oldMajor, oldMinor, family, major, minor] = m;
  const version = major ? [major, minor] : [oldMajor, oldMinor];
  const name = family.charAt(0).toUpperCase() + family.slice(1).toLowerCase();
  const v = version.filter(Boolean).join('.');
  return v ? `${name} ${v}` : name;
}

export function formatTokens(n: number): string {
  if (n < 1000) {
    return String(n);
  }
  if (n < 1_000_000) {
    return `${n < 10_000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') : Math.round(n / 1000)}k`;
  }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export interface SessionStats {
  sessionId?: string;
  model?: string;
  /** Tokens sent as input on the latest main-thread request: roughly how full the context is. */
  contextTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  responses: number;
  lastTimestamp?: string;
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export function emptyStats(): SessionStats {
  return { contextTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, responses: 0 };
}

/** Folds transcript JSONL text, fed in arbitrary chunks, into running session stats. */
export class TranscriptAccumulator {
  stats: SessionStats = emptyStats();
  private partial = '';
  private readonly seen = new Set<string>();

  /** Returns true when the stats changed. */
  push(chunk: string): boolean {
    const lines = (this.partial + chunk).split('\n');
    this.partial = lines.pop() ?? '';
    let changed = false;
    for (const line of lines) {
      changed = this.consume(line) || changed;
    }
    return changed;
  }

  private consume(line: string): boolean {
    if (!line.includes('"usage"')) {
      return false;
    }
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      return false;
    }
    const message = entry?.message;
    const usage: Usage | undefined = message?.usage;
    if (entry.type !== 'assistant' || entry.isSidechain || !usage || message.model === '<synthetic>') {
      return false;
    }
    // A response with several content blocks is written as several lines sharing one message id and usage.
    const id: string = message.id ?? entry.uuid;
    if (id) {
      if (this.seen.has(id)) {
        return false;
      }
      this.seen.add(id);
    }

    const s = this.stats;
    const input = usage.input_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheCreation = usage.cache_creation_input_tokens ?? 0;
    s.sessionId = entry.sessionId ?? s.sessionId;
    s.model = message.model ?? s.model;
    s.contextTokens = input + cacheRead + cacheCreation;
    s.inputTokens += input;
    s.cacheReadTokens += cacheRead;
    s.cacheCreationTokens += cacheCreation;
    s.outputTokens += usage.output_tokens ?? 0;
    s.responses += 1;
    s.lastTimestamp = entry.timestamp ?? s.lastTimestamp;
    return true;
  }
}
