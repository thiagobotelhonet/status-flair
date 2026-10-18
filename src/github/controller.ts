import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { readGitHub, toAlignment } from '../config';
import { Variables } from '../variables';
import { checksIcon, Issue, issueNumberFromBranch, prIcon, PullRequest, prStateLabel, reviewLabel, summarizeChecks } from './model';

const PR_FIELDS = 'number,title,state,url,isDraft,headRefName,reviewDecision,statusCheckRollup';
const LIST_FIELDS = 'number,title,state,url,isDraft,headRefName';
const POLL_MS = 60_000;
const MIN_REFRESH_MS = 15_000;
const LIST_TTL_MS = 2 * 60_000;
const ISSUE_TTL_MS = 60 * 60_000;

function gh(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd, timeout: 20_000, windowsHide: true, maxBuffer: 16 << 20 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout),
    );
  });
}

function windowFolder(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Pull request and CI status of the current branch, plus PR and issue lookups for worktrees. */
export class GitHubController implements vscode.Disposable {
  private item: vscode.StatusBarItem | undefined;
  private available: Promise<boolean> | undefined;
  private pr: PullRequest | undefined;
  private issue: Issue | undefined;
  private branch: string | undefined;
  private lastRefresh = 0;
  private refreshing: Promise<void> | undefined;
  private readonly lists = new Map<string, { at: number; prs: Promise<PullRequest[]> }>();
  private readonly issues = new Map<string, { at: number; issue: Promise<Issue | undefined> }>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly vars: Variables) {
    this.disposables.push(
      // The git extension updates ${gitBranch}; a branch switch needs a fresh lookup.
      vars.onDidChange(() => {
        if (vars.all.gitBranch !== this.branch) {
          void this.refresh(true);
        }
      }),
      vscode.window.onDidChangeWindowState((s) => s.focused && void this.refresh()),
    );
    this.timer = setInterval(() => void this.refresh(true), POLL_MS);
    this.reload();
  }

  reload(): void {
    const config = readGitHub();
    this.item?.dispose();
    this.item = undefined;
    if (config.enabled) {
      this.item = vscode.window.createStatusBarItem('statusFlair.github', toAlignment(config.alignment), config.priority);
      this.item.name = 'Status Flair: Pull request';
      this.item.command = 'statusFlair.github.openPr';
    }
    void this.refresh(true);
  }

  /** Whether the GitHub CLI is installed. */
  isAvailable(): Promise<boolean> {
    this.available ??= new Promise((resolve) => execFile('gh', ['--version'], { timeout: 10_000, windowsHide: true }, (err) => resolve(!err)));
    return this.available;
  }

  private async enabled(): Promise<boolean> {
    return readGitHub().enabled && (await this.isAvailable());
  }

  refresh(force = false): Promise<void> {
    if (!force && Date.now() - this.lastRefresh < MIN_REFRESH_MS) {
      return Promise.resolve();
    }
    this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    this.lastRefresh = Date.now();
    const folder = windowFolder();
    this.branch = this.vars.all.gitBranch;
    if (!folder || !(await this.enabled())) {
      this.pr = undefined;
      this.issue = undefined;
      this.render();
      return;
    }
    try {
      this.pr = JSON.parse(await gh(folder, ['pr', 'view', '--json', PR_FIELDS])) as PullRequest;
    } catch {
      // No PR for this branch, not a GitHub repo, or offline.
      this.pr = undefined;
    }
    this.issue = await this.issueFor(folder, this.pr?.headRefName ?? this.branch);
    this.vars.set({ prNumber: this.pr ? `#${this.pr.number}` : '', issueTitle: this.issue?.title ?? '' });
    this.render();
  }

  private render(): void {
    const item = this.item;
    if (!item) {
      return;
    }
    const pr = this.pr;
    if (!pr) {
      item.hide();
      return;
    }
    const checks = summarizeChecks(pr.statusCheckRollup);
    const review = reviewLabel(pr.reviewDecision);
    item.text = [`${prIcon(pr)} #${pr.number}`, pr.state === 'OPEN' ? checksIcon(checks.state) : '', review === 'approved' ? '$(pass)' : ''].filter(Boolean).join(' ');
    item.backgroundColor = pr.state === 'OPEN' && checks.state === 'failing' ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = { enabledCommands: ['statusFlair.github.openPr'] };
    md.appendMarkdown(`${prIcon(pr)} **#${pr.number}** ${escapeMd(pr.title)}\n\n`);
    md.appendMarkdown(`${prStateLabel(pr)}${review ? ` · ${review}` : ''}\n\n---\n\n`);
    if (checks.state !== 'none') {
      md.appendMarkdown(
        `${checksIcon(checks.state)} Checks: ${[
          checks.passing && `${checks.passing} passing`,
          checks.failing && `${checks.failing} failing`,
          checks.pending && `${checks.pending} running`,
        ]
          .filter(Boolean)
          .join(' · ')}  \n`,
      );
      for (const f of checks.failed.slice(0, 5)) {
        md.appendMarkdown(`$(x) ${f.url ? `[${escapeMd(f.name)}](${f.url})` : escapeMd(f.name)}  \n`);
      }
      md.appendMarkdown('\n');
    }
    if (this.issue) {
      md.appendMarkdown(`$(issues) [#${this.issue.number} ${escapeMd(this.issue.title)}](${this.issue.url}) · ${this.issue.state.toLowerCase()}\n\n`);
    }
    md.appendMarkdown(`---\n\n[$(link-external) Open pull request](${pr.url})`);
    item.tooltip = md;
    item.accessibilityInformation = { label: `Pull request ${pr.number}, ${prStateLabel(pr)}, checks ${checks.state}` };
    item.show();
  }

  async openPr(): Promise<void> {
    await this.refresh(true);
    if (this.pr) {
      await vscode.env.openExternal(vscode.Uri.parse(this.pr.url));
      return;
    }
    const folder = windowFolder();
    if (!folder || !(await this.isAvailable())) {
      void vscode.window.showInformationMessage('Install the GitHub CLI (gh) to see pull requests here.');
      return;
    }
    const create = await vscode.window.showInformationMessage(`No pull request for ${this.branch ?? 'this branch'} yet.`, 'Create on GitHub');
    if (create) {
      await gh(folder, ['pr', 'create', '--web']).catch((err) => vscode.window.showErrorMessage(`gh pr create failed: ${err.message}`));
    }
  }

  /** All recent PRs of the repository at `cwd`, cached briefly. */
  async pullRequests(cwd: string): Promise<PullRequest[]> {
    if (!(await this.enabled())) {
      return [];
    }
    const cached = this.lists.get(cwd);
    if (cached && Date.now() - cached.at < LIST_TTL_MS) {
      return cached.prs;
    }
    const prs = gh(cwd, ['pr', 'list', '--state', 'all', '--limit', '200', '--json', LIST_FIELDS])
      .then((out) => JSON.parse(out) as PullRequest[])
      .catch(() => [] as PullRequest[]);
    this.lists.set(cwd, { at: Date.now(), prs });
    return prs;
  }

  /** The issue a branch name points to (`feat/056-…` → #56), cached for an hour. */
  async issueFor(cwd: string, branch: string | undefined): Promise<Issue | undefined> {
    const n = issueNumberFromBranch(branch);
    if (!n || !(await this.enabled())) {
      return undefined;
    }
    const key = `${cwd}#${n}`;
    const cached = this.issues.get(key);
    if (cached && Date.now() - cached.at < ISSUE_TTL_MS) {
      return cached.issue;
    }
    const issue = gh(cwd, ['issue', 'view', String(n), '--json', 'number,title,state,url'])
      .then((out) => JSON.parse(out) as Issue)
      // GitHub numbers PRs and issues together; a PR is not the branch's issue.
      .then((i) => (i.url.includes('/pull/') ? undefined : i))
      .catch(() => undefined);
    this.issues.set(key, { at: Date.now(), issue });
    return issue;
  }

  dispose(): void {
    clearInterval(this.timer);
    this.item?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

function escapeMd(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
