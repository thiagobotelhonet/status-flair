import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { findMarkedLines, LimitHit, LimitsSnapshot, LINE_MARKERS, newer, parseTranscriptLine } from './usageReport';

const POLL_MS = 15_000;
const LOOKBACK_MS = 3 * 24 * 3_600_000;
const CHUNK = 8 << 20;

interface ScanState {
  offsets: Record<string, number>;
  snapshot?: LimitsSnapshot;
  hit?: LimitHit;
  contextWindows?: Record<string, number>;
}

/**
 * Scans every project's recent transcripts for `/usage` reports and rate-limit
 * rejections. Plan limits are account-wide, so any session counts. Read positions
 * are cached on disk, so each byte is only scanned once.
 */
export class UsageScanner implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  private state: ScanState = { offsets: {} };
  private busy = false;
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly projectsDir: string,
    private readonly cacheFile: string,
  ) {
    this.timer = setInterval(() => void this.scan(), POLL_MS);
    void this.load().then(() => this.scan());
  }

  get snapshot(): LimitsSnapshot | undefined {
    return this.state.snapshot;
  }

  get hit(): LimitHit | undefined {
    return this.state.hit;
  }

  contextWindow(model: string | undefined): number | undefined {
    return model ? this.state.contextWindows?.[model] : undefined;
  }

  private async load(): Promise<void> {
    try {
      this.state = { offsets: {}, ...JSON.parse(await fs.readFile(this.cacheFile, 'utf8')) };
      this.emitter.fire();
    } catch {
      // First run: scan from scratch.
    }
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    const tmp = `${this.cacheFile}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.state));
    await fs.rename(tmp, this.cacheFile);
  }

  async scan(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      const before = JSON.stringify([this.state.snapshot, this.state.hit, this.state.contextWindows]);
      const offsets: Record<string, number> = {};
      const since = Date.now() - LOOKBACK_MS;
      let moved = false;

      for (const dir of await fs.readdir(this.projectsDir).catch(() => [] as string[])) {
        const full = path.join(this.projectsDir, dir);
        for (const name of await fs.readdir(full).catch(() => [] as string[])) {
          if (!name.endsWith('.jsonl')) {
            continue;
          }
          const file = path.join(full, name);
          const stat = await fs.stat(file).catch(() => undefined);
          if (!stat || stat.mtimeMs < since) {
            continue;
          }
          const start = this.state.offsets[file] ?? 0;
          offsets[file] = start > stat.size ? 0 : start;
          if (stat.size > offsets[file]) {
            offsets[file] = await this.read(file, offsets[file], stat.size);
            moved = true;
          }
        }
      }

      moved ||= Object.keys(offsets).length !== Object.keys(this.state.offsets).length;
      this.state.offsets = offsets;
      if (moved) {
        await this.save().catch(() => undefined);
      }
      if (JSON.stringify([this.state.snapshot, this.state.hit, this.state.contextWindows]) !== before) {
        this.emitter.fire();
      }
    } finally {
      this.busy = false;
    }
  }

  /** Scans complete lines from `offset` and returns the offset after the last one. */
  private async read(file: string, offset: number, size: number): Promise<number> {
    const handle = await fs.open(file, 'r').catch(() => undefined);
    if (!handle) {
      return offset;
    }
    try {
      const buffer = Buffer.alloc(Math.min(CHUNK, size - offset));
      while (offset < size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
        if (bytesRead === 0) {
          break;
        }
        const chunk = buffer.subarray(0, bytesRead);
        const lastNewline = chunk.lastIndexOf(10);
        if (lastNewline === -1) {
          // Unfinished line: wait for more, unless it alone fills a chunk.
          return bytesRead === buffer.length ? offset + bytesRead : offset;
        }
        for (const line of findMarkedLines(chunk.subarray(0, lastNewline), LINE_MARKERS)) {
          const parsed = parseTranscriptLine(line);
          this.state.snapshot = newer(this.state.snapshot, parsed.snapshot);
          this.state.hit = newer(this.state.hit, parsed.hit);
          if (parsed.contextWindows) {
            this.state.contextWindows = { ...this.state.contextWindows, ...parsed.contextWindows };
          }
        }
        offset += lastNewline + 1;
      }
      return offset;
    } finally {
      await handle.close();
    }
  }

  dispose(): void {
    clearInterval(this.timer);
    this.emitter.dispose();
  }
}
