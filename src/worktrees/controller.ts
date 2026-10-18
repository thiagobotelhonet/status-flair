import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ClaudeState, isInside, StateRecord, Timeouts } from '../claude/stateModel';
import { colorForName } from '../colors';
import { readWorktrees, toAlignment, WorktreesConfig } from '../config';
import { Issue, prForBranch, prIcon, PullRequest, prStateLabel } from '../github/model';
import { Variables } from '../variables';
import {
  addLocalExclude,
  branchExists,
  branchInfo,
  changeCount,
  defaultBranch,
  fetchBase,
  git,
  isAncestor,
  isIgnored,
  isValidBranchName,
  listBranches,
  mergeBases,
} from './git';
import {
  branchLabel,
  CleanupCandidate,
  cleanupCandidate,
  CleanupInput,
  claudeStates,
  defaultBase,
  describeReasons,
  ownerOf,
  parseWorktreeList,
  resolveLocation,
  Worktree,
  worktreeAddArgs,
  worktreeName,
} from './model';

/** What the worktree view needs from the Claude integration. */
export interface ClaudeSessions {
  readonly records: StateRecord[];
  readonly timeouts: Timeouts;
  readonly onDidChangeSessions: vscode.Event<void>;
}

/** What the worktree view needs from the GitHub integration. */
export interface GitHubLookups {
  pullRequests(cwd: string): Promise<PullRequest[]>;
  issueFor(cwd: string, branch: string | undefined): Promise<Issue | undefined>;
}

const STATE_ICONS: Partial<Record<ClaudeState, string>> = {
  working: '$(loading~spin)',
  waiting: '$(bell-dot)',
  done: '$(check)',
  error: '$(error)',
};
const STATE_TEXT: Partial<Record<ClaudeState, string>> = {
  working: 'Claude working',
  waiting: 'Claude waiting for you',
  done: 'Claude done',
  error: 'Claude stopped with an error',
};

const REFRESH_MS = 30_000;
const ANALYZE_MS = 5 * 60_000;
const COLOR_WARNED_KEY = 'statusFlair.worktrees.colorWarned';

interface WorktreePick extends vscode.QuickPickItem {
  worktree?: Worktree;
  action?: 'create' | 'createWithClaude' | 'cleanup';
}

interface CleanupPick extends vscode.QuickPickItem {
  candidate: CleanupCandidate;
}

const OPEN_HERE: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('arrow-right'), tooltip: 'Open in this window' };
const COPY_PATH: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('copy'), tooltip: 'Copy path' };
const CHANGE_BASE: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('git-branch'), tooltip: 'Start from another branch' };
const DELETE: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Delete worktree' };

function windowFolder(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function displayPath(p: string, main: Worktree | undefined): string {
  if (main && isInside(p, main.path) && !isInside(main.path, p)) {
    return path.relative(main.path, p).replace(/\\/g, '/');
  }
  const home = os.homedir();
  return isInside(p, home) ? '~/' + path.relative(home, p).replace(/\\/g, '/') : p;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Status bar item and commands to switch, create and clean up git worktrees. */
export class WorktreeController implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  /** Fires when the automatic worktree color changes. */
  readonly onDidChangeColor = this.emitter.event;
  autoColor: string | undefined;

  private config: WorktreesConfig = readWorktrees();
  private item: vscode.StatusBarItem | undefined;
  private worktrees: Worktree[] = [];
  private current: Worktree | undefined;
  private cleanable = 0;
  private lastAnalysis = 0;
  private refreshing: Promise<void> | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly vars: Variables,
    private readonly claude: ClaudeSessions,
    private readonly github: GitHubLookups,
  ) {
    this.disposables.push(
      claude.onDidChangeSessions(() => this.render()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
      vscode.window.onDidChangeWindowState((s) => s.focused && void this.refresh()),
    );
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.reload();
  }

  reload(): void {
    this.config = readWorktrees();
    this.item?.dispose();
    this.item = undefined;
    if (this.config.enabled) {
      this.item = vscode.window.createStatusBarItem('statusFlair.worktrees', toAlignment(this.config.alignment), this.config.priority);
      this.item.name = 'Status Flair: Worktrees';
      this.item.command = 'statusFlair.worktrees.pick';
    }
    this.lastAnalysis = 0;
    void this.refresh();
  }

  /** Worktrees nested inside this window's folder, whose Claude sessions belong to them, not to this window. */
  nestedWorktrees(): string[] {
    const current = this.current;
    return current ? this.worktrees.filter((w) => w !== current && isInside(w.path, current.path)).map((w) => w.path) : [];
  }

  private get main(): Worktree | undefined {
    return this.worktrees.find((w) => w.main);
  }

  refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const folder = windowFolder();
    let worktrees: Worktree[] = [];
    if (folder) {
      try {
        worktrees = parseWorktreeList(await git(folder, ['worktree', 'list', '--porcelain']));
      } catch {
        // Not a git repository, or git is missing.
      }
    }
    this.worktrees = worktrees;
    this.current = folder ? ownerOf(folder, worktrees) : undefined;
    this.vars.set({
      worktreeName: this.current ? worktreeName(this.current) : '',
      worktreeCount: worktrees.length ? String(worktrees.length) : '',
    });
    if (worktrees.length > 1 && Date.now() - this.lastAnalysis > ANALYZE_MS) {
      this.lastAnalysis = Date.now();
      this.cleanable = (await this.analyze(false)).filter((c) => c.suggested).length;
    }
    await this.updateAutoColor();
    this.render();
  }

  private states(): Map<string, ClaudeState> {
    return claudeStates(this.claude.records, this.worktrees, Date.now(), this.claude.timeouts);
  }

  private render(): void {
    const item = this.item;
    if (!item) {
      return;
    }
    if (!this.current) {
      item.hide();
      return;
    }
    const states = this.states();
    const others = this.worktrees.filter((w) => w !== this.current);
    const waiting = others.filter((w) => states.get(w.path) === 'waiting').length;

    if (others.length === 0) {
      item.text = '$(worktree)';
    } else {
      item.text = `$(worktree) ${worktreeName(this.current)} · ${this.worktrees.length}${waiting ? ` $(bell-dot) ${waiting}` : ''}`;
    }

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = { enabledCommands: ['statusFlair.worktrees.pick', 'statusFlair.worktrees.create', 'statusFlair.worktrees.cleanup'] };
    md.appendMarkdown(`$(worktree) **Worktrees**${this.main ? ` · ${worktreeName(this.main)}` : ''}\n\n---\n\n`);
    for (const w of this.worktrees) {
      const state = states.get(w.path) ?? 'idle';
      const name = w === this.current ? `**${worktreeName(w)}**` : worktreeName(w);
      const extra = [w === this.current ? 'this window' : undefined, STATE_TEXT[state]].filter(Boolean).join(' · ');
      md.appendMarkdown(`${STATE_ICONS[state] ?? (w.main ? '$(repo)' : '$(git-branch)')} ${name} — \`${branchLabel(w)}\`${extra ? ` · ${extra}` : ''}  \n`);
    }
    md.appendMarkdown('\n---\n\n');
    if (this.cleanable) {
      md.appendMarkdown(
        `$(lightbulb) ${this.cleanable} ${this.cleanable === 1 ? 'worktree' : 'worktrees'} can be cleaned up · [Clean up](command:statusFlair.worktrees.cleanup)\n\n`,
      );
    }
    md.appendMarkdown('[$(list-selection) Switch](command:statusFlair.worktrees.pick) &nbsp;&nbsp; [$(add) New worktree](command:statusFlair.worktrees.create)');
    item.tooltip = md;
    item.accessibilityInformation = { label: `Worktree ${worktreeName(this.current)}, ${this.worktrees.length} worktrees` };
    item.show();
  }

  // ── Switch ──────────────────────────────────────────────────────────────

  async pick(): Promise<void> {
    await this.refresh();
    const main = this.main;
    if (!main) {
      void vscode.window.showInformationMessage('This folder is not a git repository.');
      return;
    }
    const states = this.states();
    const changes = new Map<string, number | undefined>();
    const prs = new Map<string, PullRequest | undefined>();
    const issues = new Map<string, Issue | undefined>();
    const hasClaude = !!vscode.extensions.getExtension('anthropic.claude-code');

    const build = (): (WorktreePick | vscode.QuickPickItem)[] => [
      ...this.worktrees.map((w): WorktreePick => {
        const state = states.get(w.path) ?? 'idle';
        const isCurrent = w === this.current;
        const n = changes.get(w.path);
        const pr = prs.get(w.path);
        const issue = issues.get(w.path);
        const detail = [
          issue ? `#${issue.number} ${issue.title}` : undefined,
          STATE_TEXT[state],
          w.prunable ? 'folder missing' : n === undefined ? undefined : n ? `${n} ${n === 1 ? 'change' : 'changes'}` : 'clean',
          displayPath(w.path, main),
        ].filter(Boolean);
        const prText = pr ? `  ·  ${prIcon(pr)} #${pr.number} ${prStateLabel(pr)}` : '';
        return {
          label: `${STATE_ICONS[state] ?? (w.main ? '$(repo)' : '$(worktree)')} ${worktreeName(w)}`,
          description: `${branchLabel(w)}${prText}${isCurrent ? '  ·  this window' : ''}`,
          detail: detail.join('  ·  '),
          worktree: w,
          buttons: isCurrent ? [COPY_PATH] : w.main ? [OPEN_HERE, COPY_PATH] : [OPEN_HERE, COPY_PATH, DELETE],
        };
      }),
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(add) New worktree…', action: 'create' },
      ...(hasClaude ? [{ label: '$(sparkle) New worktree with Claude…', action: 'createWithClaude' as const }] : []),
      ...(this.worktrees.length > 1 ? [{ label: '$(trash) Clean up worktrees…', action: 'cleanup' as const }] : []),
    ];

    const qp = vscode.window.createQuickPick<WorktreePick>();
    qp.title = `Worktrees · ${worktreeName(main)}`;
    qp.placeholder = 'Open a worktree in a new window, or create one';
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    qp.items = build();

    // Change counts, PRs and issues take a moment; fill them in as they arrive.
    const rebuild = () => {
      const active = qp.activeItems[0]?.worktree?.path ?? qp.activeItems[0]?.action;
      qp.items = build();
      const again = qp.items.find((i) => (i.worktree?.path ?? i.action) === active);
      if (again) {
        qp.activeItems = [again];
      }
    };
    void Promise.all(
      this.worktrees.map(async (w) => {
        if (!w.prunable) {
          changes.set(w.path, await changeCount(w.path));
        }
      }),
    ).then(rebuild);
    void this.github.pullRequests(main.path).then(async (list) => {
      for (const w of this.worktrees) {
        prs.set(w.path, w.branch ? prForBranch(list, w.branch) : undefined);
      }
      rebuild();
      await Promise.all(this.worktrees.map(async (w) => issues.set(w.path, await this.github.issueFor(main.path, w.branch))));
      rebuild();
    });

    qp.onDidTriggerItemButton(async ({ item, button }) => {
      const w = item.worktree;
      if (!w) {
        return;
      }
      if (button === COPY_PATH) {
        await vscode.env.clipboard.writeText(w.path);
        void vscode.window.setStatusBarMessage('$(copy) Worktree path copied', 2000);
      } else if (button === OPEN_HERE) {
        qp.hide();
        await this.open(w, false);
      } else if (button === DELETE) {
        qp.hide();
        await this.remove(w);
      }
    });
    qp.onDidAccept(async () => {
      const selected = qp.selectedItems[0];
      qp.hide();
      if (selected?.action === 'create') {
        await this.create();
      } else if (selected?.action === 'createWithClaude') {
        await vscode.commands.executeCommand('claude-vscode.createWorktree');
      } else if (selected?.action === 'cleanup') {
        await this.cleanup();
      } else if (selected?.worktree && selected.worktree !== this.current) {
        await this.open(selected.worktree, this.config.openIn === 'newWindow');
      }
    });
    qp.onDidHide(() => qp.dispose());
    qp.show();
  }

  private async open(w: Worktree, newWindow: boolean): Promise<void> {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(w.path), { forceNewWindow: newWindow });
  }

  // ── Create ──────────────────────────────────────────────────────────────

  /**
   * Creates a worktree without touching any other one. New branches start from an
   * up-to-date base (by default the main worktree's branch on the remote), never from
   * whatever branch this window, possibly an agent's, has checked out.
   */
  async create(): Promise<void> {
    await this.refresh();
    const main = this.main;
    if (!main) {
      void vscode.window.showInformationMessage('Open a git repository to create a worktree.');
      return;
    }
    const config = this.config;
    const remoteHasMain = !!main.branch && (await branchExists(main.path, `refs/remotes/origin/${main.branch}`).catch(() => false));
    const fallbackBase = defaultBase({
      configured: config.base,
      mainBranch: main.branch,
      remoteHasMain,
      originHead: remoteHasMain ? undefined : await defaultBranch(main.path),
    });

    let base = fallbackBase;
    let name = '';
    for (;;) {
      const answer = await this.askBranch(main, base, name);
      name = answer.value;
      if (answer.kind === 'cancel') {
        return;
      }
      if (answer.kind === 'ok') {
        break;
      }
      base = (await this.pickBase(main, base, fallbackBase)) ?? base;
    }
    const target = resolveLocation(config.location, main.path, name);

    let startedFrom: string;
    try {
      startedFrom = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Creating worktree ${path.basename(target)}` },
        async (progress) => {
          const localExists = await branchExists(main.path, `refs/heads/${name}`);
          const remoteExists = !localExists && (await branchExists(main.path, `refs/remotes/origin/${name}`));
          let fetched = false;
          if (!localExists && !remoteExists) {
            progress.report({ message: `updating ${base}…` });
            fetched = await fetchBase(main.path, base);
          }
          progress.report({ message: 'checking out…' });
          await git(main.path, worktreeAddArgs({ target, branch: name, base, localExists, remoteExists }), 120_000);
          await this.keepOutOfGit(main, target);
          // The main worktree holds the canonical .env and friends; an agent's copy may be mid-edit.
          await this.copyFiles(main.path, target);
          return localExists || remoteExists ? `existing branch ${name}` : `${base}${fetched ? '' : ' (not fetched: offline?)'}`;
        },
      );
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not create the worktree: ${errorMessage(err)}`);
      return;
    }
    this.lastAnalysis = 0;
    await this.refresh();
    void vscode.window.setStatusBarMessage(`$(worktree) Created ${path.basename(target)} from ${startedFrom}`, 5000);
    const created = this.worktrees.find((w) => isInside(w.path, target) && isInside(target, w.path));
    if (created) {
      await this.open(created, config.openIn === 'newWindow');
    }
  }

  private async validateBranch(
    main: Worktree,
    value: string,
    base: string,
  ): Promise<string | vscode.InputBoxValidationMessage | undefined> {
    const name = value.trim();
    if (!name) {
      return undefined;
    }
    if (!(await isValidBranchName(main.path, name))) {
      return 'Not a valid branch name';
    }
    if (this.worktrees.some((w) => w.branch === name)) {
      return `"${name}" is already checked out in another worktree`;
    }
    const target = resolveLocation(this.config.location, main.path, name);
    if (await fs.stat(target).then(() => true, () => false)) {
      return `${displayPath(target, main)} already exists`;
    }
    const exists =
      (await branchExists(main.path, `refs/heads/${name}`).catch(() => false)) ||
      (await branchExists(main.path, `refs/remotes/origin/${name}`).catch(() => false));
    return {
      message: `Creates ${displayPath(target, main)} · ${exists ? `checks out the existing branch ${name}` : `new branch from ${base}`}`,
      severity: vscode.InputBoxValidationSeverity.Info,
    };
  }

  /** Asks for the branch name; the title button switches the base without losing what was typed. */
  private askBranch(main: Worktree, base: string, value: string): Promise<{ kind: 'ok' | 'cancel' | 'changeBase'; value: string }> {
    return new Promise((resolve) => {
      const box = vscode.window.createInputBox();
      box.title = 'New worktree';
      box.placeholder = 'feat/my-change';
      box.prompt = `New branches start from ${base}, updated first. Use the branch button to start from somewhere else.`;
      box.value = value;
      box.buttons = [CHANGE_BASE];
      let settled = false;
      const done = (kind: 'ok' | 'cancel' | 'changeBase') => {
        if (!settled) {
          settled = true;
          resolve({ kind, value: box.value.trim() });
          box.hide();
        }
      };
      let latest = 0;
      const validate = async (text: string) => {
        const mine = ++latest;
        const message = await this.validateBranch(main, text, base);
        if (mine === latest) {
          box.validationMessage = message;
        }
        return message;
      };
      box.onDidChangeValue((text) => void validate(text));
      box.onDidTriggerButton(() => done('changeBase'));
      box.onDidAccept(async () => {
        if (!box.value.trim()) {
          return;
        }
        box.busy = true;
        const message = await validate(box.value);
        box.busy = false;
        if (typeof message !== 'string') {
          done('ok');
        }
      });
      box.onDidHide(() => {
        done('cancel');
        box.dispose();
      });
      box.show();
      if (value) {
        void validate(value);
      }
    });
  }

  private async pickBase(main: Worktree, current: string, fallback: string): Promise<string | undefined> {
    const here = this.current && !this.current.main ? this.current.branch : undefined;
    const branches = await listBranches(main.path);
    const items: (vscode.QuickPickItem & { ref?: string })[] = [
      { label: `$(star-full) ${fallback}`, description: 'default · the latest shared work', ref: fallback },
      ...(here && here !== fallback ? [{ label: `$(git-branch) ${here}`, description: "this window's branch · includes its commits", ref: here }] : []),
      { label: 'All branches', kind: vscode.QuickPickItemKind.Separator },
      ...branches.filter((b) => b !== fallback && b !== here).map((b) => ({ label: b, ref: b })),
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Start the new branch from…',
      placeHolder: `Currently ${current}`,
      matchOnDescription: true,
    });
    return picked?.ref;
  }

  /** Worktrees created inside the repository are excluded locally (`.git/info/exclude`), never in a committed file. */
  private async keepOutOfGit(main: Worktree, target: string): Promise<void> {
    if (!isInside(target, main.path)) {
      return;
    }
    const rel = path.relative(main.path, target).replace(/\\/g, '/');
    if (await isIgnored(main.path, rel)) {
      return;
    }
    const parent = path.posix.dirname(rel);
    await addLocalExclude(main.path, parent === '.' ? `/${rel}/` : `/${parent}/`);
  }

  /** Copies untracked files like `.env` that a fresh checkout would not have. */
  private async copyFiles(fromRoot: string, toRoot: string): Promise<void> {
    for (const rel of this.config.copyFiles) {
      const src = path.join(fromRoot, rel);
      const dst = path.join(toRoot, rel);
      if (!isInside(src, fromRoot) || !(await fs.stat(src).then(() => true, () => false))) {
        continue;
      }
      await fs.cp(src, dst, { recursive: true, force: false, errorOnExist: false }).catch(() => undefined);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────

  async remove(w: Worktree): Promise<void> {
    const main = this.main;
    if (!main || w.main || w === this.current) {
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `Delete worktree "${worktreeName(w)}"?`,
      { modal: true, detail: `${w.path}\n\nThe branch "${branchLabel(w)}" is kept.` },
      'Delete',
    );
    if (choice !== 'Delete') {
      return;
    }
    try {
      await this.removeWorktree(main, w, false);
    } catch (err) {
      const message = errorMessage(err);
      if (!/modified|untracked|use --force/i.test(message)) {
        void vscode.window.showErrorMessage(`Could not delete the worktree: ${message}`);
        return;
      }
      const force = await vscode.window.showWarningMessage(
        `"${worktreeName(w)}" has uncommitted changes.`,
        { modal: true, detail: 'Deleting it anyway loses those changes for good.' },
        'Delete anyway',
      );
      if (force !== 'Delete anyway') {
        return;
      }
      try {
        await this.removeWorktree(main, w, true);
      } catch (err2) {
        void vscode.window.showErrorMessage(`Could not delete the worktree: ${errorMessage(err2)}`);
        return;
      }
    }
    this.lastAnalysis = 0;
    await this.refresh();
    void vscode.window.setStatusBarMessage(`$(trash) Deleted worktree ${worktreeName(w)}`, 3000);
  }

  private async removeWorktree(main: Worktree, w: Worktree, force: boolean): Promise<void> {
    await git(main.path, ['worktree', 'remove', ...(force ? ['--force'] : []), w.path], 60_000);
  }

  // ── Clean up ────────────────────────────────────────────────────────────

  private async analyze(fetch: boolean): Promise<CleanupCandidate[]> {
    const main = this.main;
    if (!main) {
      return [];
    }
    if (fetch) {
      // Learns which remote branches were deleted after their PR merged. Offline is fine.
      await git(main.path, ['fetch', '--prune', '--quiet'], 30_000).catch(() => undefined);
    }
    const bases = await mergeBases(main.path, main.branch);
    const info = await branchInfo(main.path, bases);
    const prs = await this.github.pullRequests(main.path);
    const states = this.states();
    const now = Date.now();
    const staleDays = this.config.staleDays;

    const candidates = await Promise.all(
      this.worktrees.map(async (w) => {
        const created = w.prunable ? undefined : await fs.stat(w.path).then((s) => s.birthtimeMs || s.ctimeMs, () => undefined);
        const last = w.branch ? info.lastCommit.get(w.branch) : undefined;
        const input: CleanupInput = {
          worktree: w,
          current: w === this.current,
          claude: states.get(w.path) ?? 'idle',
          merged: w.branch
            ? info.merged.has(w.branch)
            : !!w.head && !w.prunable && (await isAncestor(main.path, w.head, bases)),
          gone: !!w.branch && info.gone.has(w.branch),
          prMerged: !!w.branch && prForBranch(prs, w.branch)?.state === 'MERGED',
          lastCommitDays: last ? (now / 1000 - last) / 86_400 : undefined,
          ageDays: created ? (now - created) / 86_400_000 : undefined,
          baseBranches: bases,
        };
        const candidate = cleanupCandidate(input, staleDays);
        if (!candidate || w.prunable) {
          return candidate;
        }
        // Only candidates pay for a `git status`.
        return cleanupCandidate({ ...input, changes: await changeCount(w.path) }, staleDays);
      }),
    );
    return candidates.filter((c): c is CleanupCandidate => !!c);
  }

  async cleanup(): Promise<void> {
    await this.refresh();
    const main = this.main;
    if (!main) {
      void vscode.window.showInformationMessage('Open a git repository to clean up its worktrees.');
      return;
    }
    const candidates = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Checking worktrees…' },
      () => this.analyze(true),
    );
    this.lastAnalysis = Date.now();
    this.cleanable = candidates.filter((c) => c.suggested).length;
    this.render();
    if (!candidates.length) {
      void vscode.window.showInformationMessage('Nothing to clean up: every worktree has unmerged or recent work.');
      return;
    }

    const items: CleanupPick[] = candidates.map((c) => ({
      label: `${c.warning ? '$(warning)' : '$(worktree)'} ${worktreeName(c.worktree)}`,
      description: branchLabel(c.worktree),
      detail: [describeReasons(c.reasons), c.warning].filter(Boolean).join('  ·  '),
      picked: c.suggested,
      candidate: c,
    }));
    const selected = await vscode.window.showQuickPick(items, {
      title: 'Clean up worktrees',
      placeHolder: 'Checked ones are safe to delete. Branches are kept unless you choose otherwise next.',
      canPickMany: true,
      matchOnDetail: true,
    });
    if (!selected?.length) {
      return;
    }

    const risky = selected.filter((s) => s.candidate.warning);
    if (risky.length) {
      const go = await vscode.window.showWarningMessage(
        `Delete ${risky.length === 1 ? 'a worktree' : `${risky.length} worktrees`} that need attention?`,
        { modal: true, detail: risky.map((r) => `• ${worktreeName(r.candidate.worktree)}: ${r.candidate.warning}`).join('\n') },
        'Delete anyway',
      );
      if (go !== 'Delete anyway') {
        return;
      }
    }

    const removed: CleanupCandidate[] = [];
    const failed: string[] = [];
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Deleting worktrees…' }, async () => {
      for (const { candidate } of selected) {
        try {
          if (!candidate.worktree.prunable) {
            await this.removeWorktree(main, candidate.worktree, !!candidate.warning);
          }
          removed.push(candidate);
        } catch (err) {
          failed.push(`${worktreeName(candidate.worktree)}: ${errorMessage(err)}`);
        }
      }
      await git(main.path, ['worktree', 'prune'], 30_000).catch(() => undefined);
    });

    const branches = removed.filter((c) => c.worktree.branch && c.reasons.some((r) => r === 'merged' || r === 'pr-merged' || r === 'gone'));
    if (branches.length) {
      const del = await vscode.window.showInformationMessage(
        `Also delete ${branches.length === 1 ? 'its merged branch' : `their ${branches.length} merged branches`}?`,
        { modal: true, detail: branches.map((c) => `• ${c.worktree.branch}`).join('\n') },
        'Delete branches',
      );
      if (del === 'Delete branches') {
        for (const c of branches) {
          // Squash-merged branches look unmerged to git, so PR-merged and remote-deleted ones need -D.
          const flag = c.reasons.includes('merged') ? '-d' : '-D';
          await git(main.path, ['branch', flag, c.worktree.branch!]).catch((err) => failed.push(`${c.worktree.branch}: ${errorMessage(err)}`));
        }
      }
    }

    this.lastAnalysis = 0;
    await this.refresh();
    if (failed.length) {
      void vscode.window.showWarningMessage(`Some items could not be deleted:\n${failed.join('\n')}`);
    } else {
      void vscode.window.showInformationMessage(`Cleaned up ${removed.length} ${removed.length === 1 ? 'worktree' : 'worktrees'}.`);
    }
  }

  // ── Color ───────────────────────────────────────────────────────────────

  /** Linked worktrees get a stable color, written only where git ignores `.vscode/settings.json`. */
  private async updateAutoColor(): Promise<void> {
    let color: string | undefined;
    const current = this.current;
    if (this.config.autoColor && current && !current.main) {
      if (await isIgnored(current.path, '.vscode/settings.json')) {
        color = colorForName(worktreeName(current));
      } else if (!this.context.workspaceState.get(COLOR_WARNED_KEY)) {
        await this.context.workspaceState.update(COLOR_WARNED_KEY, true);
        void this.offerToIgnoreSettings(current);
      }
    }
    if (color !== this.autoColor) {
      this.autoColor = color;
      this.emitter.fire();
    }
  }

  private async offerToIgnoreSettings(w: Worktree): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      'Status Flair can color this worktree, but that writes to .vscode/settings.json, which git would show as a change. Ignore that file locally (in .git/info/exclude, not committed)?',
      'Ignore locally',
    );
    if (choice !== 'Ignore locally') {
      return;
    }
    await addLocalExclude(w.path, '/.vscode/settings.json');
    if (!(await isIgnored(w.path, '.vscode/settings.json'))) {
      void vscode.window.showWarningMessage('.vscode/settings.json is committed in this repository, so worktree colors stay off here.');
      return;
    }
    await this.updateAutoColor();
  }

  dispose(): void {
    clearInterval(this.timer);
    this.item?.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.emitter.dispose();
  }
}
