import * as fsSync from 'fs';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const POLL_MS = 3000;

/**
 * Reads the small per-session JSON files written by the hook and status line scripts.
 * Files older than `pruneMs` (by their `ts`) are deleted.
 */
export class JsonDirWatcher<T extends { ts: number }> implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  records: T[] = [];

  private snapshot = '';
  private watcher: fsSync.FSWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly dir: string,
    private readonly pruneMs: number,
  ) {
    this.timer = setInterval(() => void this.read(), POLL_MS);
    this.watch();
    void this.read();
  }

  private watch(): void {
    try {
      fsSync.mkdirSync(this.dir, { recursive: true });
      this.watcher = fsSync.watch(this.dir, () => {
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => void this.read(), 100);
      });
      this.watcher.on('error', () => this.watcher?.close());
    } catch {
      // Polling still covers it.
    }
  }

  private async read(): Promise<void> {
    const names = (await fs.readdir(this.dir).catch(() => [] as string[])).filter((n) => n.endsWith('.json'));
    const records: T[] = [];
    for (const name of names) {
      const file = path.join(this.dir, name);
      try {
        const record = JSON.parse(await fs.readFile(file, 'utf8')) as T;
        if (Date.now() - record.ts > this.pruneMs) {
          await fs.rm(file, { force: true });
        } else {
          records.push(record);
        }
      } catch {
        // Half-written or foreign file; skip it.
      }
    }
    const snapshot = JSON.stringify(records);
    if (snapshot !== this.snapshot) {
      this.snapshot = snapshot;
      this.records = records;
      this.emitter.fire();
    }
  }

  dispose(): void {
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    this.watcher?.close();
    this.emitter.dispose();
  }
}
