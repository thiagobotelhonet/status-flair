import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { readClaude, toAlignment } from '../config';
import { git } from '../worktrees/git';
import { lensSession, LensSession, parseNumstat, statusText } from './lensModel';
import { lensDocument } from './lensView';
import { effectiveState, StateRecord, Timeouts } from './stateModel';

/** What the Lens needs from the Claude integration. */
export interface LensSource {
  readonly records: StateRecord[];
  readonly timeouts: Timeouts;
  readonly onDidChangeSessions: vscode.Event<void>;
  open(): Promise<void>;
  /** Model and context of this window's current session, from its transcript. */
  windowSession(): { sessionId?: string; model?: string; contextPercent?: number };
}

const VIEW_ID = 'statusFlair.lens';
const SHOW_HOURS = 24;
const NUMSTAT_MS = 3000;

function windowFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

/** "Claude Lens": a live view of what each Claude Code session is doing right now. */
export class LensController implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private item: vscode.StatusBarItem | undefined;
  private selected: string | undefined;
  private numstat = { root: '', at: 0, stats: new Map<string, { added: number; removed: number }>() };
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly source: LensSource) {
    this.disposables.push(
      vscode.window.registerWebviewViewProvider(VIEW_ID, this),
      source.onDidChangeSessions(() => this.refresh()),
    );
    // States fade (done → idle) without any file changing.
    this.timer = setInterval(() => this.refresh(), 5000);
    this.reload();
  }

  reload(): void {
    const config = readClaude();
    this.item?.dispose();
    this.item = undefined;
    if (config.enabled && config.lens) {
      this.item = vscode.window.createStatusBarItem('statusFlair.lensItem', toAlignment(config.alignment), config.priority + 2);
      this.item.name = 'Status Flair: Claude Lens';
      this.item.command = 'statusFlair.lens.show';
    }
    this.refresh();
  }

  async show(): Promise<void> {
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
  }

  private sessions(): LensSession[] {
    const now = Date.now();
    const folders = windowFolders();
    // In the Lens a finished session stays "done" (it fades elsewhere); stale work still counts as idle.
    const timeouts = { ...this.source.timeouts, doneMs: Infinity };
    return this.source.records
      .filter((r) => now - r.ts <= SHOW_HOURS * 3_600_000)
      .map((r) => lensSession(r, effectiveState(r, now, timeouts), folders))
      .sort((a, b) => Number(b.here) - Number(a.here) || b.since - a.since);
  }

  private chosen(sessions: LensSession[]): LensSession | undefined {
    return sessions.find((s) => s.id === this.selected) ?? sessions.find((s) => s.here) ?? sessions[0];
  }

  private refresh(): void {
    const sessions = this.sessions();
    this.renderItem(sessions.filter((s) => s.here));
    if (this.view?.visible) {
      void this.post(sessions);
    }
  }

  private renderItem(here: LensSession[]): void {
    const item = this.item;
    if (!item) {
      return;
    }
    const active = here.find((s) => s.state === 'waiting') ?? here.find((s) => s.state === 'working') ?? here[0];
    if (!active) {
      item.hide();
      return;
    }
    let text = '';
    if (active.state === 'working' || active.state === 'waiting') {
      text = active.current ? statusText(active.current) : active.state === 'waiting' ? 'Waiting for you' : 'Thinking…';
    }
    item.text = `$(pulse)${text ? ` ${text}` : ''}`;
    item.tooltip = text ? `Claude Lens · ${active.label}: ${text}` : `Claude Lens · ${active.label}`;
    item.accessibilityInformation = { label: `Claude Lens, ${text || active.state}` };
    item.show();
  }

  private async post(sessions: LensSession[]): Promise<void> {
    const view = this.view;
    if (!view) {
      return;
    }
    const session = this.chosen(sessions);
    if (session) {
      const mine = this.source.windowSession();
      if (session.here && (!mine.sessionId || mine.sessionId === session.id)) {
        session.model = mine.model;
        session.contextPercent = mine.contextPercent;
      }
      const stats = await this.diffStats(session);
      for (const f of session.files) {
        const s = stats.get(f.label);
        if (s) {
          f.added = s.added;
          f.removed = s.removed;
        }
      }
    }
    void view.webview.postMessage({
      type: 'update',
      now: Date.now(),
      sessions: sessions.map((s) => ({ id: s.id, label: s.label, state: s.state, here: s.here })),
      session,
      selected: session?.id,
    });
  }

  /** Lines added/removed against HEAD for the files the session touched. */
  private async diffStats(session: LensSession): Promise<Map<string, { added: number; removed: number }>> {
    if (!session.files.length) {
      return new Map();
    }
    const fresh = this.numstat.root === session.root && Date.now() - this.numstat.at < NUMSTAT_MS;
    if (!fresh) {
      this.numstat = { root: session.root, at: Date.now(), stats: this.numstat.root === session.root ? this.numstat.stats : new Map() };
      const relative = session.files.filter((f) => !path.isAbsolute(f.label)).map((f) => f.label);
      const out = relative.length
        ? await git(session.root, ['-c', 'core.quotepath=off', 'diff', '--numstat', 'HEAD', '--', ...relative]).catch(() => '')
        : '';
      this.numstat.stats = parseNumstat(out);
    }
    return this.numstat.stats;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = html(view.webview);
    view.webview.onDidReceiveMessage(async (msg: { type: string; id?: string; path?: string }) => {
      if (msg.type === 'ready') {
        this.refresh();
      } else if (msg.type === 'select' && msg.id) {
        this.selected = msg.id;
        this.refresh();
      } else if (msg.type === 'openFile' && msg.path) {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.path));
      } else if (msg.type === 'goTo' && msg.id) {
        const s = this.sessions().find((x) => x.id === msg.id);
        if (s?.here) {
          await this.source.open();
        } else if (s) {
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(s.root), { forceNewWindow: true });
        }
      }
    });
    view.onDidChangeVisibility(() => this.refresh());
    view.onDidDispose(() => (this.view = undefined));
  }

  dispose(): void {
    clearInterval(this.timer);
    this.item?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

function html(webview: vscode.Webview): string {
  return lensDocument(webview.cspSource, randomBytes(16).toString('base64'));
}
