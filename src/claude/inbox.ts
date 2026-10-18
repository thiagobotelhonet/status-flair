import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { readClaude, toAlignment } from '../config';
import { desktopNotify } from './desktopNotify';
import { dayTotals, FocusInfo, formatDuration, InboxEntry, inboxEntries, markSeen, SeenMap } from './inboxModel';
import { hookDir } from './paths';
import { ClaudeState, isInside, StateRecord, Timeouts } from './stateModel';

/** What the inbox needs from the Claude integration. */
export interface InboxSource {
  readonly records: StateRecord[];
  readonly timeouts: Timeouts;
  readonly onDidChangeSessions: vscode.Event<void>;
  open(): Promise<void>;
}

const ICONS: Record<ClaudeState, string> = {
  idle: '$(circle-outline)',
  working: '$(loading~spin)',
  waiting: '$(bell-dot)',
  done: '$(check)',
  error: '$(error)',
};
const STATE_TEXT: Record<ClaudeState, string> = {
  idle: 'idle',
  working: 'working for',
  waiting: 'waiting for you for',
  done: 'finished',
  error: 'stopped with an error',
};

const RECENT_DONE_MS = 10 * 60_000;
const TICK_MS = 5000;
/** Unfocused windows wait so the focused one gets to show an in-app message instead. */
const UNFOCUSED_DELAY_MS = 1500;
const FRESH_EVENT_MS = 60_000;

interface InboxPick extends vscode.QuickPickItem {
  entry?: InboxEntry;
  markAllRead?: boolean;
}

function windowFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

function isHere(e: InboxEntry): boolean {
  return windowFolders().some((f) => isInside(e.root, f) && isInside(f, e.root));
}

function stateLine(e: InboxEntry): string {
  return e.state === 'done' || e.state === 'error' ? `${STATE_TEXT[e.state]} ${formatDuration(e.forMs)} ago` : `${STATE_TEXT[e.state]} ${formatDuration(e.forMs)}`;
}

/**
 * Every Claude Code session on this machine, in one status bar item. Finished sessions
 * stay as unread (✓ n) until you look at them, so you know which worktree's agent is done.
 */
export class InboxController implements vscode.Disposable {
  private item: vscode.StatusBarItem | undefined;
  private seen: SeenMap = {};
  private readonly lastSeenState = new Map<string, string>();
  private primed = false;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly source: InboxSource) {
    this.disposables.push(
      source.onDidChangeSessions(() => void this.update(true)),
      vscode.window.onDidChangeWindowState((s) => {
        void this.writeFocus(s.focused);
        if (s.focused) {
          void this.update(false);
        }
      }),
    );
    this.timer = setInterval(() => void this.update(false), TICK_MS);
    void this.writeFocus(vscode.window.state.focused);
    this.reload();
  }

  private get dir(): string {
    return hookDir(readClaude().configDir);
  }

  private get seenFile(): string {
    return path.join(this.dir, 'seen.json');
  }

  reload(): void {
    const config = readClaude();
    this.item?.dispose();
    this.item = undefined;
    if (config.enabled && config.inbox) {
      this.item = vscode.window.createStatusBarItem('statusFlair.inbox', toAlignment(config.alignment), config.priority + 1);
      this.item.name = 'Status Flair: Claude sessions';
      this.item.command = 'statusFlair.claude.inbox';
    }
    void this.update(false);
  }

  private async update(sessionsChanged: boolean): Promise<void> {
    this.seen = await this.readSeen();
    // Looking at a session's window counts as reading it.
    if (vscode.window.state.focused) {
      const here = this.entries().filter((e) => e.unread && isHere(e));
      if (here.length) {
        await this.acknowledge(here.map((e) => e.record));
      }
    }
    this.render();
    if (sessionsChanged) {
      await this.notifyTransitions();
    }
  }

  private entries(): InboxEntry[] {
    return inboxEntries(this.source.records, Date.now(), this.source.timeouts, RECENT_DONE_MS, this.seen);
  }

  private render(): void {
    const item = this.item;
    if (!item) {
      return;
    }
    const entries = this.entries();
    const count = (pred: (e: InboxEntry) => boolean) => entries.filter(pred).length;
    const waiting = count((e) => e.state === 'waiting');
    const errors = count((e) => e.state === 'error' && e.unread);
    const finished = count((e) => e.state === 'done' && e.unread);
    const working = count((e) => e.state === 'working');
    const parts = [
      waiting ? `$(bell-dot) ${waiting}` : '',
      errors ? `$(error) ${errors}` : '',
      finished ? `$(check) ${finished}` : '',
      working ? `$(loading~spin) ${working}` : '',
    ].filter(Boolean);
    if (!parts.length) {
      item.hide();
      return;
    }
    item.text = parts.join('  ');
    item.backgroundColor = waiting
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : errors
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : undefined;

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = { enabledCommands: ['statusFlair.claude.inbox'] };
    md.appendMarkdown('**Claude sessions**\n\n---\n\n');
    for (const e of entries.slice(0, 8)) {
      const name = e.unread ? `**${e.label}** · new` : `**${e.label}**`;
      md.appendMarkdown(`${ICONS[e.state]} ${name} · ${stateLine(e)}  \n`);
    }
    if (entries.length > 8) {
      md.appendMarkdown(`…and ${entries.length - 8} more  \n`);
    }
    const totals = dayTotals(this.source.records, Date.now());
    if (totals.workedMs || totals.waitedMs) {
      md.appendMarkdown(
        `\n---\n\nLast 24h: Claude worked ${formatDuration(totals.workedMs)} · waited for you ${formatDuration(totals.waitedMs)}\n\n`,
      );
    }
    md.appendMarkdown('\n[$(list-selection) Go to a session](command:statusFlair.claude.inbox)');
    item.tooltip = md;
    item.accessibilityInformation = {
      label: `Claude sessions: ${waiting} waiting, ${finished} finished and unread, ${working} working, ${errors} with errors`,
    };
    item.show();
  }

  async pick(): Promise<void> {
    await this.update(false);
    const entries = this.entries();
    if (!entries.length) {
      void vscode.window.showInformationMessage('No active Claude Code sessions right now.');
      return;
    }
    const items: InboxPick[] = entries.map((e) => {
      const r = e.record;
      const time = r.workedMs || r.waitedMs ? `worked ${formatDuration(r.workedMs ?? 0)} · waited ${formatDuration(r.waitedMs ?? 0)}` : '';
      return {
        label: `${ICONS[e.state]} ${e.label}${e.unread ? '  $(circle-filled)' : ''}`,
        description: `${stateLine(e)}${isHere(e) ? '  ·  this window' : ''}`,
        detail: [r.prompt ? `“${r.prompt}”` : '', time].filter(Boolean).join('  ·  ') || undefined,
        entry: e,
      };
    });
    if (entries.some((e) => e.unread)) {
      items.push({ label: '', kind: vscode.QuickPickItemKind.Separator }, { label: '$(check-all) Mark all as read', markAllRead: true });
    }
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Claude sessions',
      placeHolder: 'Jump to a session · ● = finished and not seen yet',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (picked?.markAllRead) {
      await this.acknowledge(entries.filter((e) => e.unread).map((e) => e.record));
      this.render();
    } else if (picked?.entry) {
      await this.goTo(picked.entry);
    }
  }

  private async goTo(e: InboxEntry): Promise<void> {
    await this.acknowledge([e.record]);
    this.render();
    if (isHere(e)) {
      await this.source.open();
      return;
    }
    // Opening a folder that is already open focuses its window.
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(e.root), { forceNewWindow: true });
  }

  // ── Read state, shared by all windows ──────────────────────────────────

  private async readSeen(): Promise<SeenMap> {
    try {
      return JSON.parse(await fs.readFile(this.seenFile, 'utf8')) as SeenMap;
    } catch {
      return {};
    }
  }

  private async acknowledge(records: StateRecord[]): Promise<void> {
    if (!records.length) {
      return;
    }
    // Re-read so marks made by other windows are kept; drop sessions that no longer exist.
    const live = new Set(this.source.records.map((r) => r.sessionId));
    const merged = markSeen(await this.readSeen(), records);
    this.seen = Object.fromEntries(Object.entries(merged).filter(([id]) => live.has(id)));
    try {
      await fs.mkdir(this.dir, { recursive: true });
      const tmp = `${this.seenFile}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.seen));
      await fs.rename(tmp, this.seenFile);
    } catch {
      // Not critical: the session just stays unread.
    }
  }

  // ── Notifications ───────────────────────────────────────────────────────

  private async notifyTransitions(): Promise<void> {
    const mode = readClaude().notify;
    const now = Date.now();
    const fresh: InboxEntry[] = [];
    for (const e of this.entries()) {
      const key = `${e.state}:${e.record.since ?? e.record.ts}`;
      if (this.lastSeenState.get(e.record.sessionId) !== key) {
        this.lastSeenState.set(e.record.sessionId, key);
        if (this.primed && now - e.record.ts < FRESH_EVENT_MS) {
          fresh.push(e);
        }
      }
    }
    // The first read only learns what is already there.
    this.primed = true;
    if (mode === 'off') {
      return;
    }
    for (const e of fresh) {
      if (e.state === 'waiting' || (mode === 'all' && (e.state === 'done' || e.state === 'error'))) {
        void this.notify(e);
      }
    }
  }

  private async notify(e: InboxEntry): Promise<void> {
    const focused = vscode.window.state.focused;
    if (!focused) {
      await new Promise((r) => setTimeout(r, UNFOCUSED_DELAY_MS));
    }
    if (!(await this.claim(e))) {
      return;
    }
    if (await this.userIsLookingAt(e)) {
      return;
    }
    const title =
      e.state === 'waiting' ? `Claude is waiting for you · ${e.label}` : e.state === 'error' ? `Claude stopped with an error · ${e.label}` : `Claude finished · ${e.label}`;
    const body = e.record.prompt ?? 'Open the session to continue.';
    if (focused) {
      const go = await vscode.window.showInformationMessage(`${title}: “${body}”`, 'Go to session');
      if (go) {
        await this.goTo(e);
      }
    } else {
      desktopNotify(title, body);
    }
  }

  /** Only one VS Code window notifies about a given state change. */
  private async claim(e: InboxEntry): Promise<boolean> {
    const dir = path.join(this.dir, 'notified');
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${e.record.sessionId}-${e.state}-${e.record.since ?? e.record.ts}`), '', { flag: 'wx' });
      void this.pruneClaims(dir);
      return true;
    } catch {
      return false;
    }
  }

  private async pruneClaims(dir: string): Promise<void> {
    for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
      const file = path.join(dir, name);
      const stat = await fs.stat(file).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > 24 * 3_600_000) {
        await fs.rm(file, { force: true });
      }
    }
  }

  private async readFocus(): Promise<FocusInfo | undefined> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.dir, 'focus.json'), 'utf8')) as FocusInfo;
    } catch {
      return undefined;
    }
  }

  /** True when the focused VS Code window is the session's own window. */
  private async userIsLookingAt(e: InboxEntry): Promise<boolean> {
    const focus = await this.readFocus();
    return !!focus?.focused && focus.folders.some((f) => isInside(e.root, f) && isInside(f, e.root));
  }

  /** Shares which window has focus, so other windows know whether to notify. */
  private async writeFocus(focused: boolean): Promise<void> {
    const folders = windowFolders();
    if (!folders.length) {
      return;
    }
    if (!focused) {
      // Only clear the record if it is still ours; another window may have taken focus.
      const current = await this.readFocus();
      if (!current || current.folders.join('|') !== folders.join('|')) {
        return;
      }
    }
    const info: FocusInfo = { focused, folders, ts: Date.now() };
    const file = path.join(this.dir, 'focus.json');
    try {
      await fs.mkdir(this.dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(info));
      await fs.rename(tmp, file);
    } catch {
      // Not critical.
    }
  }

  dispose(): void {
    clearInterval(this.timer);
    this.item?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
