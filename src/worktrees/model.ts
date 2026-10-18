import * as path from 'path';
import { ClaudeState, effectiveState, isInside, moreUrgent, StateRecord, Timeouts } from '../claude/stateModel';

export interface Worktree {
  path: string;
  head?: string;
  /** Short branch name; undefined when detached. */
  branch?: string;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  /** The repository's main working tree (always listed first by git). */
  main: boolean;
}

/** Parses `git worktree list --porcelain`. */
export function parseWorktreeList(output: string): Worktree[] {
  const worktrees: Worktree[] = [];
  for (const block of output.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean);
    const first = lines[0];
    if (!first?.startsWith('worktree ')) {
      continue;
    }
    const value = (key: string) => lines.find((l) => l === key || l.startsWith(key + ' '))?.slice(key.length + 1);
    const branch = value('branch');
    worktrees.push({
      path: first.slice('worktree '.length),
      head: value('HEAD'),
      branch: branch?.replace(/^refs\/heads\//, ''),
      bare: lines.includes('bare'),
      locked: lines.some((l) => l === 'locked' || l.startsWith('locked ')),
      prunable: lines.some((l) => l === 'prunable' || l.startsWith('prunable ')),
      main: worktrees.length === 0,
    });
  }
  return worktrees;
}

export function worktreeName(w: Worktree): string {
  return path.basename(w.path.replace(/[\\/]+$/, ''));
}

export function branchLabel(w: Worktree): string {
  return w.branch ?? (w.head ? `detached at ${w.head.slice(0, 7)}` : 'detached');
}

/** `feat/login page` → `feat-login-page`. */
export function branchSlug(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree';
}

/** The worktree that contains `p`; nested worktrees win over the one they sit in. */
export function ownerOf(p: string, worktrees: Worktree[]): Worktree | undefined {
  let best: Worktree | undefined;
  for (const w of worktrees) {
    if (isInside(p, w.path) && (!best || w.path.length > best.path.length)) {
      best = w;
    }
  }
  return best;
}

/**
 * Expands the location template for a new worktree. Relative results are resolved
 * against the main worktree.
 */
export function resolveLocation(template: string, mainRoot: string, branch: string): string {
  const root = mainRoot.replace(/[\\/]+$/, '');
  const vars: Record<string, string> = {
    repoRoot: root,
    repoParent: path.dirname(root),
    repoName: path.basename(root),
    branch,
    branchSlug: branchSlug(branch),
  };
  const expanded = template.replace(/\$\{(\w+)\}/g, (m, name: string) => vars[name] ?? m);
  return path.resolve(root, expanded);
}

/**
 * The branch new worktrees start from: the configured one, else the main worktree's
 * branch as it is on the remote (so a new task never inherits another worktree's
 * commits), else origin's default branch.
 */
export function defaultBase(o: { configured?: string; mainBranch?: string; remoteHasMain: boolean; originHead?: string }): string {
  if (o.configured?.trim()) {
    return o.configured.trim();
  }
  if (o.mainBranch && o.remoteHasMain) {
    return `origin/${o.mainBranch}`;
  }
  return o.originHead ?? o.mainBranch ?? 'HEAD';
}

/**
 * Arguments for `git worktree add`. An existing branch is checked out as is (a remote-only
 * one gets a local branch tracking it); a new branch starts from `base` without tracking it,
 * so pushes and "remote branch deleted" checks follow the new branch, not the base.
 */
export function worktreeAddArgs(o: { target: string; branch: string; base: string; localExists: boolean; remoteExists: boolean }): string[] {
  if (o.localExists || o.remoteExists) {
    return ['worktree', 'add', o.target, o.branch];
  }
  return ['worktree', 'add', '--no-track', '-b', o.branch, o.target, o.base];
}

/** The most urgent Claude state of the sessions running in each worktree. */
export function claudeStates(
  records: StateRecord[],
  worktrees: Worktree[],
  now: number,
  t: Timeouts,
): Map<string, ClaudeState> {
  const states = new Map<string, ClaudeState>();
  for (const r of records) {
    const owner = ownerOf(r.cwd, worktrees);
    if (owner) {
      states.set(owner.path, moreUrgent(states.get(owner.path) ?? 'idle', effectiveState(r, now, t)));
    }
  }
  return states;
}

export type CleanupReason = 'merged' | 'pr-merged' | 'gone' | 'missing' | 'stale';

export interface CleanupInput {
  worktree: Worktree;
  current: boolean;
  /** Uncommitted changes; undefined if unknown. */
  changes?: number;
  claude: ClaudeState;
  merged: boolean;
  gone: boolean;
  /** The branch's pull request was merged (catches squash merges git cannot see). */
  prMerged?: boolean;
  /** Days since the branch's last commit. */
  lastCommitDays?: number;
  /** Days since the worktree folder was created. */
  ageDays?: number;
  /** Branches PRs merge into, like `origin/main` or `developer`. */
  baseBranches?: string[];
}

export interface CleanupCandidate {
  worktree: Worktree;
  reasons: CleanupReason[];
  /** Pre-selected: safe to delete. */
  suggested: boolean;
  /** Why deleting it needs a second look. */
  warning?: string;
}

/**
 * Decides whether a worktree is worth cleaning up. Never offers the main worktree or
 * the one open in this window. A branch with no commits of its own also counts as
 * "merged", so merged worktrees younger than a day are left alone.
 */
export function cleanupCandidate(input: CleanupInput, staleDays: number): CleanupCandidate | undefined {
  const { worktree: w } = input;
  if (w.main || input.current || w.bare) {
    return undefined;
  }
  const reasons: CleanupReason[] = [];
  if (w.prunable) {
    reasons.push('missing');
  }
  const onBase = !!w.branch && (input.baseBranches ?? []).some((b) => b.replace(/^origin\//, '') === w.branch);
  if (input.merged && !onBase && (input.ageDays ?? 0) >= 1) {
    reasons.push('merged');
  }
  if (input.prMerged) {
    reasons.push('pr-merged');
  }
  if (input.gone && !input.prMerged) {
    reasons.push('gone');
  }
  if (input.lastCommitDays !== undefined && input.lastCommitDays >= staleDays && !reasons.length) {
    reasons.push('stale');
  }
  if (!reasons.length) {
    return undefined;
  }

  let warning: string | undefined;
  if (input.claude === 'working' || input.claude === 'waiting') {
    warning = `Claude is ${input.claude === 'working' ? 'working' : 'waiting'} here`;
  } else if (input.changes) {
    warning = `${input.changes} uncommitted ${input.changes === 1 ? 'change' : 'changes'} would be lost`;
  } else if (w.locked) {
    warning = 'locked';
  }
  const suggested = !warning && reasons.some((r) => r !== 'stale');
  return { worktree: w, reasons, suggested, warning };
}

const REASON_LABELS: Record<CleanupReason, string> = {
  merged: 'merged',
  'pr-merged': 'pull request merged',
  gone: 'remote branch deleted',
  missing: 'folder no longer exists',
  stale: 'no commits in a while',
};

export function describeReasons(reasons: CleanupReason[]): string {
  return reasons.map((r) => REASON_LABELS[r]).join(', ');
}
