import * as fs from 'fs';
import * as vscode from 'vscode';
import { ClaudeConfig, readClaude, toAlignment } from '../config';
import { label, render } from '../template';
import { Variables } from '../variables';
import { copyScripts, installIntegration, integrationStatus, IntegrationStatus, uninstallIntegration } from './hooks';
import { JsonDirWatcher } from './jsonDirWatcher';
import { claudeDir, projectsDir, stateDir, usageDir } from './paths';
import { SessionWatcher } from './sessionWatcher';
import { aggregate, ClaudeState, StateRecord } from './stateModel';
import { formatTokens, prettyModelName, SessionStats } from './transcript';
import * as path from 'path';
import { formatAgo, formatPercent, formatReset, formatUsd, Limit, limitName, summarize, UsageRecord, UsageView } from './usage';
import { PALETTES, panelAltText, PanelModel, PanelRow, renderPanelSvg, svgDataUri } from './usagePanel';
import { UsageScanner } from './usageScanner';
import { addPoint, forecast, UsagePoint } from './forecast';
import { formatDuration } from './inboxModel';

const ICONS: Record<ClaudeState, string> = {
  idle: '$(sparkle)',
  working: '$(loading~spin)',
  waiting: '$(bell-dot)',
  done: '$(check)',
  error: '$(error)',
};

const STATE_LABELS: Record<ClaudeState, string> = {
  idle: 'idle',
  working: 'working',
  waiting: 'waiting for you',
  done: 'done',
  error: 'stopped with an error',
};

const CLAUDE_EXTENSION = 'anthropic.claude-code';
const PROMPTED_KEY = 'statusFlair.claude.hooksPrompted';
const REPLACED_KEY = 'statusFlair.claude.replacedStatusLine';
const TICK_MS = 2000;
const STATE_PRUNE_MS = 24 * 3_600_000;
const USAGE_PRUNE_MS = 8 * 24 * 3_600_000;
const HISTORY_KEY = 'statusFlair.claude.usageHistory';

interface UsageHistory {
  fiveHour: UsagePoint[];
  sevenDay: UsagePoint[];
}

function folders(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

/** The Claude Code item: state from hooks, usage from the status line, model and tokens from the transcript. */
export class ClaudeController implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  /** Fires when the aggregated state changes. */
  readonly onDidChangeState = this.emitter.event;
  state: ClaudeState = 'idle';
  private readonly sessionsEmitter = new vscode.EventEmitter<void>();
  /** Fires when any session's state file changes, in any folder. */
  readonly onDidChangeSessions = this.sessionsEmitter.event;
  /** Folders whose sessions belong elsewhere, like worktrees nested in this one. */
  excludedFolders: () => string[] = () => [];

  private config: ClaudeConfig = readClaude();
  private item: vscode.StatusBarItem | undefined;
  private sessions: SessionWatcher | undefined;
  private states: JsonDirWatcher<StateRecord> | undefined;
  private usageRecords: JsonDirWatcher<UsageRecord> | undefined;
  private scanner: UsageScanner | undefined;
  private usage: UsageView = { scoped: [] };
  private integration: IntegrationStatus = { hooks: false, statusLine: false };
  private lastSessionId: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly ticker: NodeJS.Timeout;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly vars: Variables,
  ) {
    this.disposables.push(
      vars.onDidChange(() => this.render()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.sessions?.rescan()),
      vscode.window.onDidChangeActiveColorTheme(() => this.render()),
    );
    // Timeouts (done → idle) and window resets happen without any file changing.
    this.ticker = setInterval(() => {
      this.updateState();
      this.updateUsage();
    }, TICK_MS);
    this.reload();
  }

  /** Re-reads settings and restarts the watchers. */
  reload(): void {
    this.config = readClaude();
    this.stopWatchers();
    this.item?.dispose();
    this.item = undefined;

    if (!this.config.enabled) {
      this.usage = { scoped: [] };
      this.publish('idle');
      return;
    }
    const dir = this.config.configDir;
    this.item = vscode.window.createStatusBarItem('statusFlair.claude', toAlignment(this.config.alignment), this.config.priority);
    this.item.name = 'Status Flair: Claude Code';
    this.item.command = this.config.clickAction === 'none' ? undefined : 'statusFlair.claude.open';

    this.sessions = new SessionWatcher(projectsDir(dir), folders, this.config.sessionMaxAgeMs);
    this.states = new JsonDirWatcher<StateRecord>(stateDir(dir), STATE_PRUNE_MS);
    this.usageRecords = new JsonDirWatcher<UsageRecord>(usageDir(dir), USAGE_PRUNE_MS);
    this.scanner = new UsageScanner(projectsDir(dir), path.join(this.context.globalStorageUri.fsPath, 'usage-scan-v2.json'));
    this.scanner.onDidChange(() => this.updateUsage());
    this.sessions.onDidChange(() => {
      this.updateUsage();
      this.publish(this.state);
    });
    this.states.onDidChange(() => {
      this.updateState();
      this.sessionsEmitter.fire();
    });
    this.usageRecords.onDidChange(() => this.updateUsage());
    void this.checkIntegration();
  }

  private async checkIntegration(): Promise<void> {
    const dir = this.config.configDir;
    this.integration = await integrationStatus(dir);
    const { hooks, statusLine, statusLineCommand } = this.integration;

    if (hooks || statusLine) {
      // Keep the copied scripts in sync with the installed extension version.
      await copyScripts(this.context, dir).catch(() => undefined);
    }
    if (hooks && !statusLine && statusLineCommand !== this.context.globalState.get(REPLACED_KEY)) {
      // Another tool rewrote Claude Code's status line after we wrapped it.
      await this.context.globalState.update(REPLACED_KEY, statusLineCommand);
      const choice = await vscode.window.showInformationMessage(
        "Claude Code's status line was replaced by another tool, so Status Flair stopped receiving plan usage. Reconnect it? The new status line keeps working.",
        'Reconnect',
      );
      if (choice === 'Reconnect') {
        await this.installIntegration();
      }
    } else if (!hooks && !this.context.globalState.get(PROMPTED_KEY) && fs.existsSync(claudeDir(dir))) {
      await this.context.globalState.update(PROMPTED_KEY, true);
      const choice = await vscode.window.showInformationMessage(
        'Status Flair can show when Claude Code is working or waiting for you, and your plan usage. Connect it to Claude Code?',
        'Connect',
        'Not now',
      );
      if (choice === 'Connect') {
        await this.installIntegration();
      }
    }
    this.render();
  }

  async installIntegration(): Promise<void> {
    if (await installIntegration(this.context, this.config.configDir)) {
      this.integration = await integrationStatus(this.config.configDir);
      this.render();
    }
  }

  async uninstallIntegration(): Promise<void> {
    await uninstallIntegration(this.config.configDir);
    this.integration = await integrationStatus(this.config.configDir);
    this.render();
  }

  /** Model and context fill of this window's latest session, for the Lens. */
  windowSession(): { sessionId?: string; model?: string; contextPercent?: number } {
    const stats = this.sessions?.stats;
    return {
      sessionId: stats?.sessionId,
      model: stats?.model ? prettyModelName(stats.model) : undefined,
      contextPercent: this.contextWindow().percent,
    };
  }

  get records(): StateRecord[] {
    return this.states?.records ?? [];
  }

  get timeouts(): { doneMs: number; staleMs: number } {
    return { doneMs: this.config.doneTimeoutMs, staleMs: this.config.staleTimeoutMs };
  }

  private updateState(): void {
    const { state, record } = aggregate(this.records, folders(), Date.now(), this.timeouts, this.excludedFolders());
    if (record && record.sessionId !== this.lastSessionId) {
      this.lastSessionId = record.sessionId;
      this.sessions?.rescan();
    }
    if (state !== this.state) {
      this.publish(state);
    }
  }

  private updateUsage(): void {
    const now = Date.now();
    const next = summarize(this.usageRecords?.records ?? [], folders(), now, this.sessions?.stats?.sessionId, {
      snapshot: this.scanner?.snapshot,
      hit: this.scanner?.hit,
    });
    if (JSON.stringify(next) !== JSON.stringify(this.usage)) {
      this.usage = next;
      this.recordHistory(now);
      this.publish(this.state);
    }
  }

  /** Keeps past readings of each window so the panel can project when it runs out. */
  private recordHistory(now: number): void {
    const { fiveHour, sevenDay, limitsAt } = this.usage;
    if (!limitsAt) {
      return;
    }
    const history = this.context.globalState.get<UsageHistory>(HISTORY_KEY, { fiveHour: [], sevenDay: [] });
    const next: UsageHistory = {
      fiveHour: fiveHour ? addPoint(history.fiveHour, { ts: limitsAt, ...fiveHour }, now) : history.fiveHour,
      sevenDay: sevenDay ? addPoint(history.sevenDay, { ts: limitsAt, ...sevenDay }, now) : history.sevenDay,
    };
    if (JSON.stringify(next) !== JSON.stringify(history)) {
      void this.context.globalState.update(HISTORY_KEY, next);
    }
  }

  private forecastNote(points: UsagePoint[], limit: Limit, minSpanMs: number, now: number): Pick<PanelRow, 'note' | 'noteAlert'> {
    const f = forecast(points, limit, minSpanMs);
    if (f?.exhaustAt) {
      return { note: `At this pace it runs out ${formatReset(f.exhaustAt, now)}`, noteAlert: true };
    }
    if (f?.projected !== undefined) {
      return { note: `On pace for about ${formatPercent(f.projected)} by reset` };
    }
    return {};
  }

  /** Context window size and fill, from the status line for this session or from what `/usage` reported for the model. */
  private contextWindow(): { size?: number; percent?: number } {
    const stats = this.sessions?.stats;
    const session = this.usage.session;
    const fromStatusLine = session && (!stats?.sessionId || session.sessionId === stats.sessionId) ? session.context_window : undefined;
    const size = fromStatusLine?.context_window_size ?? this.scanner?.contextWindow(stats?.model);
    const percent =
      fromStatusLine?.used_percentage ?? (size && stats ? Math.min(100, (stats.contextTokens / size) * 100) : undefined);
    return { size, percent };
  }

  private publish(state: ClaudeState): void {
    const changed = state !== this.state;
    this.state = state;
    const stats = this.sessions?.stats;
    const { fiveHour, sevenDay, session } = this.usage;
    const contextPercent = this.contextWindow().percent;
    const cost = session?.cost?.total_cost_usd;
    this.vars.set({
      claudeModel: stats?.model ? prettyModelName(stats.model) : '',
      claudeContext: stats ? formatTokens(stats.contextTokens) : '',
      claudeContextPercent: contextPercent !== undefined ? formatPercent(contextPercent) : '',
      claudeState: stats || state !== 'idle' ? STATE_LABELS[state] : '',
      claudeUsage5h: fiveHour ? formatPercent(fiveHour.percent) : '',
      claudeUsageWeek: sevenDay ? formatPercent(sevenDay.percent) : '',
      claudeCost: cost !== undefined ? formatUsd(cost) : '',
    });
    this.render();
    if (changed) {
      this.emitter.fire();
    }
  }

  private render(): void {
    const item = this.item;
    if (!item) {
      return;
    }
    const stats = this.sessions?.stats;
    if (!stats && this.state === 'idle') {
      item.hide();
      return;
    }
    const text = render(this.config.text, this.vars.all) || 'Claude';
    const limitHigh = [this.usage.fiveHour, this.usage.sevenDay].some(
      (l) => l && l.percent >= this.config.usageWarningThreshold,
    );
    const contextHigh = (this.contextWindow().percent ?? 0) >= this.config.contextWarningThreshold;
    item.text = label(ICONS[this.state], text);
    item.backgroundColor =
      this.state === 'error' || this.usage.limitHit
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : this.state === 'waiting' || limitHigh || contextHigh
          ? new vscode.ThemeColor('statusBarItem.warningBackground')
          : undefined;
    item.tooltip = this.tooltip(stats);
    item.accessibilityInformation = { label: `Claude Code ${STATE_LABELS[this.state]}, ${text}` };
    item.show();
  }

  private panelModel(stats: SessionStats | undefined, now: number): PanelModel {
    const { fiveHour, sevenDay, scoped, limitsAt, limitsSource, limitHit, session } = this.usage;
    const resets = (at: number) => `Resets ${formatReset(at, now)}`;
    const history = this.context.globalState.get<UsageHistory>(HISTORY_KEY, { fiveHour: [], sevenDay: [] });
    const rows: PanelRow[] = [];

    if (fiveHour) {
      rows.push({
        title: 'Session',
        detail: '5 hours',
        right: resets(fiveHour.resetsAt),
        percent: fiveHour.percent,
        ...this.forecastNote(history.fiveHour, fiveHour, 30 * 60_000, now),
      });
    }
    if (sevenDay) {
      rows.push({
        title: 'Weekly',
        detail: 'all models',
        right: resets(sevenDay.resetsAt),
        percent: sevenDay.percent,
        ...this.forecastNote(history.sevenDay, sevenDay, 6 * 3_600_000, now),
      });
    }
    for (const s of scoped) {
      rows.push({ title: 'Weekly', detail: s.label, right: resets(s.resetsAt), percent: s.percent });
    }
    if (stats) {
      const { size, percent } = this.contextWindow();
      const threshold = this.config.contextWarningThreshold;
      rows.push(
        size
          ? {
              title: 'Context',
              detail: `${formatTokens(stats.contextTokens)} of ${formatTokens(size)}`,
              percent: percent ?? 0,
              warnAt: threshold,
              ...((percent ?? 0) >= threshold && { note: 'Getting full: consider /compact or a fresh session', noteAlert: true }),
            }
          : { title: 'Context', right: `${formatTokens(stats.contextTokens)} tokens` },
      );
    }

    const footer: string[] = [];
    if (stats) {
      const cost = session?.cost?.total_cost_usd;
      footer.push(
        ['This session', cost !== undefined ? formatUsd(cost) : undefined, `${stats.responses} responses`].filter(Boolean).join(' · '),
        `${formatTokens(stats.outputTokens)} out · ${formatTokens(stats.inputTokens + stats.cacheCreationTokens)} in · ${formatTokens(stats.cacheReadTokens)} cached`,
      );
      const record = this.records.find((r) => r.sessionId === stats.sessionId);
      if (record?.workedMs || record?.waitedMs) {
        footer.push(`Claude worked ${formatDuration(record.workedMs ?? 0)} · waited for you ${formatDuration(record.waitedMs ?? 0)}`);
      }
    }
    if (limitsAt) {
      const via = limitsSource === 'usage' ? '/usage' : 'status line';
      footer.push(`Limits from ${via}, ${formatAgo(limitsAt, now)} · run /usage to refresh`);
    } else if (this.integration.statusLine) {
      footer.push('Run /usage in Claude Code to see your plan limits');
    }

    return {
      banner: limitHit ? `${limitName(limitHit.type)} limit reached · ${resets(limitHit.resetsAt).toLowerCase()}` : undefined,
      rows,
      footer,
    };
  }

  private tooltip(stats: SessionStats | undefined): vscode.MarkdownString {
    const now = Date.now();
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = {
      enabledCommands: ['statusFlair.claude.open', 'statusFlair.claude.installHooks', 'statusFlair.openSettings'],
    };

    const session = this.usage.session;
    const model = stats?.model ? prettyModelName(stats.model) : session?.model?.display_name;
    md.appendMarkdown(`${ICONS[this.state]} **Claude Code**${model ? ` · ${model}` : ''} · *${STATE_LABELS[this.state]}*\n\n---\n\n`);

    const panel = this.panelModel(stats, now);
    if (panel.rows.length || panel.banner || panel.footer.length) {
      const kind = vscode.window.activeColorTheme.kind;
      const light = kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
      const svg = renderPanelSvg(panel, PALETTES[light ? 'light' : 'dark'], this.config.usageWarningThreshold);
      md.appendMarkdown(`![${panelAltText(panel)}](${svgDataUri(svg)})\n\n`);
    }
    if (!this.integration.hooks) {
      md.appendMarkdown('$(info) Live state and plan limits: [Connect to Claude Code](command:statusFlair.claude.installHooks)\n\n');
    }

    md.appendMarkdown(
      '---\n\n[$(link-external) Open Claude](command:statusFlair.claude.open) &nbsp;&nbsp; [$(gear) Settings](command:statusFlair.openSettings)',
    );
    return md;
  }

  async open(): Promise<void> {
    const action = this.config.clickAction;
    const hasExtension = !!vscode.extensions.getExtension(CLAUDE_EXTENSION);
    if (action === 'newConversation' && hasExtension) {
      await vscode.commands.executeCommand('claude-vscode.newConversation');
    } else if (action !== 'openTerminal' && hasExtension) {
      await vscode.commands.executeCommand('claude-vscode.editor.openLast');
    } else {
      const terminal = vscode.window.createTerminal({ name: 'Claude Code' });
      terminal.show();
      terminal.sendText('claude');
    }
  }

  private stopWatchers(): void {
    this.sessions?.dispose();
    this.states?.dispose();
    this.usageRecords?.dispose();
    this.scanner?.dispose();
    this.sessions = undefined;
    this.states = undefined;
    this.usageRecords = undefined;
    this.scanner = undefined;
  }

  dispose(): void {
    clearInterval(this.ticker);
    this.stopWatchers();
    this.item?.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.emitter.dispose();
    this.sessionsEmitter.dispose();
  }
}
