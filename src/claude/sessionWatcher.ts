import { promises as fs } from 'fs';
import * as path from 'path';
import { StringDecoder } from 'string_decoder';
import * as vscode from 'vscode';
import { encodeProjectPath, SessionStats, TranscriptAccumulator } from './transcript';

const POLL_MS = 2000;
const RESCAN_MS = 10_000;
const CHUNK = 1 << 20;

/** Finds the most recently written transcript among the project folders Claude keeps for `folders`. */
export async function findLatestTranscript(projectsDir: string, folders: string[]): Promise<string | undefined> {
  const wanted = new Set(folders.map((f) => encodeProjectPath(f).toLowerCase()));
  const dirs = (await fs.readdir(projectsDir).catch(() => [] as string[])).filter((d) => wanted.has(d.toLowerCase()));

  let latest: { file: string; mtime: number } | undefined;
  for (const dir of dirs) {
    const full = path.join(projectsDir, dir);
    const files = (await fs.readdir(full).catch(() => [] as string[])).filter((f) => f.endsWith('.jsonl'));
    for (const name of files) {
      const file = path.join(full, name);
      const stat = await fs.stat(file).catch(() => undefined);
      if (stat && (!latest || stat.mtimeMs > latest.mtime)) {
        latest = { file, mtime: stat.mtimeMs };
      }
    }
  }
  return latest?.file;
}

/** Tails the latest Claude Code transcript for the workspace and exposes its stats. */
export class SessionWatcher implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  stats: SessionStats | undefined;

  private file: string | undefined;
  private acc = new TranscriptAccumulator();
  private decoder = new StringDecoder('utf8');
  private offset = 0;
  private lastScan = 0;
  private busy = false;
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly projectsDir: string,
    private readonly folders: () => string[],
    private readonly maxAgeMs: number,
  ) {
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    void this.tick();
  }

  /** Look for a newer transcript on the next tick, e.g. after a new session starts. */
  rescan(): void {
    this.lastScan = 0;
    void this.tick();
  }

  private reset(file: string | undefined): void {
    this.file = file;
    this.acc = new TranscriptAccumulator();
    this.decoder = new StringDecoder('utf8');
    this.offset = 0;
  }

  private async tick(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      if (await this.update()) {
        this.emitter.fire();
      }
    } catch {
      // Transcript vanished mid-read; the next tick starts over.
    } finally {
      this.busy = false;
    }
  }

  /** Returns true when the visible stats changed. */
  private async update(): Promise<boolean> {
    if (!this.file || Date.now() - this.lastScan > RESCAN_MS) {
      this.lastScan = Date.now();
      const latest = await findLatestTranscript(this.projectsDir, this.folders());
      if (latest !== this.file) {
        this.reset(latest);
      }
    }
    const stat = this.file ? await fs.stat(this.file).catch(() => undefined) : undefined;
    if (!this.file || !stat) {
      const wasShown = !!this.stats;
      this.reset(undefined);
      this.stats = undefined;
      return wasShown;
    }
    if (stat.size < this.offset) {
      this.reset(this.file);
    }

    let changed = false;
    if (stat.size > this.offset) {
      const handle = await fs.open(this.file, 'r');
      try {
        const buffer = Buffer.alloc(CHUNK);
        while (this.offset < stat.size) {
          const { bytesRead } = await handle.read(buffer, 0, Math.min(CHUNK, stat.size - this.offset), this.offset);
          if (bytesRead === 0) {
            break;
          }
          this.offset += bytesRead;
          changed = this.acc.push(this.decoder.write(buffer.subarray(0, bytesRead))) || changed;
        }
      } finally {
        await handle.close();
      }
    }

    const fresh = this.maxAgeMs <= 0 || Date.now() - stat.mtimeMs <= this.maxAgeMs;
    const next = fresh && this.acc.stats.model ? { ...this.acc.stats } : undefined;
    const wasShown = !!this.stats;
    this.stats = next;
    return changed || wasShown !== !!next;
  }

  dispose(): void {
    clearInterval(this.timer);
    this.emitter.dispose();
  }
}
