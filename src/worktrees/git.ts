import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';

export class GitError extends Error {
  constructor(
    message: string,
    readonly code: number | undefined,
  ) {
    super(message);
  }
}

export function git(cwd: string, args: string[], timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout, maxBuffer: 16 << 20, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const code = typeof (err as any).code === 'number' ? (err as any).code : undefined;
        reject(new GitError((stderr || err.message).trim(), code));
      } else {
        resolve(stdout);
      }
    });
  });
}

/** True when git exits 0, false when it exits 1; other failures throw. */
async function gitTest(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch (err) {
    if (err instanceof GitError && err.code === 1) {
      return false;
    }
    throw err;
  }
}

export async function changeCount(worktree: string): Promise<number | undefined> {
  try {
    return (await git(worktree, ['status', '--porcelain'])).split('\n').filter((l) => l.trim()).length;
  } catch {
    return undefined;
  }
}

export async function branchExists(cwd: string, ref: string): Promise<boolean> {
  return gitTest(cwd, ['show-ref', '--verify', '--quiet', ref]);
}

export async function isValidBranchName(cwd: string, name: string): Promise<boolean> {
  return gitTest(cwd, ['check-ref-format', '--branch', name]).catch(() => false);
}

/** Whether `relPath` (relative to `cwd`) is ignored and untracked. */
export async function isIgnored(cwd: string, relPath: string): Promise<boolean> {
  return gitTest(cwd, ['check-ignore', '-q', relPath]).catch(() => false);
}

export async function commonGitDir(cwd: string): Promise<string> {
  return path.resolve(cwd, (await git(cwd, ['rev-parse', '--git-common-dir'])).trim());
}

/** Adds `pattern` to `.git/info/exclude`, which is local and never committed. */
export async function addLocalExclude(cwd: string, pattern: string): Promise<void> {
  const file = path.join(await commonGitDir(cwd), 'info', 'exclude');
  const current = await fs.readFile(file, 'utf8').catch(() => '');
  if (current.split(/\r?\n/).includes(pattern)) {
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${pattern}\n`);
}

/** The branch PRs merge into: origin's HEAD, else the first of main/master/develop/developer that exists. */
export async function defaultBranch(cwd: string): Promise<string | undefined> {
  try {
    return (await git(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])).trim();
  } catch {
    for (const name of ['main', 'master', 'develop', 'developer']) {
      if (await branchExists(cwd, `refs/heads/${name}`).catch(() => false)) {
        return name;
      }
    }
    return undefined;
  }
}

/**
 * Updates a remote-tracking base like `origin/developer` before branching from it.
 * Returns false when offline or the base is local; the existing ref is used then.
 */
export async function fetchBase(cwd: string, base: string): Promise<boolean> {
  const m = /^([^/]+)\/(.+)$/.exec(base);
  if (!m) {
    return false;
  }
  const remotes = (await git(cwd, ['remote']).catch(() => '')).split('\n').map((r) => r.trim());
  if (!remotes.includes(m[1])) {
    return false;
  }
  return git(cwd, ['fetch', '--quiet', m[1], m[2]], 30_000).then(
    () => true,
    () => false,
  );
}

/** Local and remote branches, most recently committed first. */
export async function listBranches(cwd: string): Promise<string[]> {
  const out = await git(cwd, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)', 'refs/heads', 'refs/remotes']).catch(
    () => '',
  );
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^refs\/remotes\/[^/]+\/HEAD$/.test(l))
    .map((l) => l.replace(/^refs\/(heads|remotes)\//, ''))
    .slice(0, 300);
}

export interface BranchInfo {
  merged: Set<string>;
  /** Branches whose upstream was deleted on the remote, typically after a merged PR. */
  gone: Set<string>;
  /** Unix seconds of each branch's last commit. */
  lastCommit: Map<string, number>;
}

/**
 * Branches work can be merged into: origin's default branch plus the main worktree's
 * branch and its remote copy (teams often merge into `develop` while origin's HEAD is `main`).
 */
export async function mergeBases(cwd: string, mainBranch: string | undefined): Promise<string[]> {
  const bases = new Set<string>();
  const fallback = await defaultBranch(cwd);
  if (fallback) {
    bases.add(fallback);
  }
  if (mainBranch) {
    bases.add(mainBranch);
    if (await branchExists(cwd, `refs/remotes/origin/${mainBranch}`).catch(() => false)) {
      bases.add(`origin/${mainBranch}`);
    }
  }
  return [...bases];
}

export async function isAncestor(cwd: string, commit: string, bases: string[]): Promise<boolean> {
  for (const base of bases) {
    if (await gitTest(cwd, ['merge-base', '--is-ancestor', commit, base]).catch(() => false)) {
      return true;
    }
  }
  return false;
}

export async function branchInfo(cwd: string, bases: string[]): Promise<BranchInfo> {
  const merged = new Set<string>();
  for (const base of bases) {
    const out = await git(cwd, ['branch', '--merged', base, '--format=%(refname:short)']).catch(() => '');
    out.split('\n').map((l) => l.trim()).filter(Boolean).forEach((b) => merged.add(b));
  }
  const gone = new Set<string>();
  const lastCommit = new Map<string, number>();
  const refs = await git(cwd, ['for-each-ref', 'refs/heads', '--format=%(refname:short)|%(upstream:track)|%(committerdate:unix)']).catch(
    () => '',
  );
  for (const line of refs.split('\n')) {
    const [name, track, date] = line.trim().split('|');
    if (!name) {
      continue;
    }
    if (track === '[gone]') {
      gone.add(name);
    }
    lastCommit.set(name, Number(date) || 0);
  }
  return { merged, gone, lastCommit };
}
