import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { StateRecord } from '../claude/stateModel';
import { colorForName, contrastRatio } from '../colors';
import { addLocalExclude, branchInfo, defaultBranch, fetchBase, isAncestor, isIgnored, listBranches, mergeBases } from '../worktrees/git';
import {
  branchSlug,
  claudeStates,
  CleanupInput,
  defaultBase,
  cleanupCandidate,
  ownerOf,
  parseWorktreeList,
  resolveLocation,
  Worktree,
  worktreeAddArgs,
  worktreeName,
} from '../worktrees/model';

// Real output of `git worktree list --porcelain` (git 2.56, Windows).
const porcelain = [
  'worktree C:/dev/hub',
  'HEAD 20edb710eb811980c17b1a48ef3b3bfb257d2e41',
  'branch refs/heads/developer',
  '',
  'worktree C:/dev/hub/.claude/worktrees/048-operacao',
  'HEAD acdad3a5f8ea4a1788085cb75f1d369cde8df151',
  'branch refs/heads/docs/048-regras',
  '',
  'worktree C:/dev/hub/.claude/worktrees/old',
  'HEAD 1c8c16922a885a7a09961873ee641e76a4330658',
  'detached',
  'locked reason here',
  'prunable gitdir file points to non-existent location',
  '',
].join('\r\n');

describe('parseWorktreeList', () => {
  const list = parseWorktreeList(porcelain);
  it('reads every worktree and marks the first as main', () => {
    assert.deepEqual(
      list.map((w) => [worktreeName(w), w.branch, w.main]),
      [
        ['hub', 'developer', true],
        ['048-operacao', 'docs/048-regras', false],
        ['old', undefined, false],
      ],
    );
  });
  it('reads flags', () => {
    assert.deepEqual([list[2].locked, list[2].prunable, list[2].head?.slice(0, 7)], [true, true, '1c8c169']);
  });
});

describe('ownerOf', () => {
  const list = parseWorktreeList(porcelain);
  it('gives nested worktrees precedence over the one they sit in', () => {
    assert.equal(ownerOf('c:\\dev\\hub\\.claude\\worktrees\\048-operacao\\src', list)?.branch, 'docs/048-regras');
    assert.equal(ownerOf('C:\\dev\\hub\\src', list)?.branch, 'developer');
    assert.equal(ownerOf('C:\\elsewhere', list), undefined);
  });
});

describe('claudeStates', () => {
  it('attributes each session to its own worktree', () => {
    const list = parseWorktreeList(porcelain);
    const now = 1_000_000;
    const records: StateRecord[] = [
      { sessionId: 'a', cwd: 'C:\\dev\\hub', state: 'done', ts: now },
      { sessionId: 'b', cwd: 'C:\\dev\\hub\\.claude\\worktrees\\048-operacao', state: 'waiting', ts: now },
    ];
    const states = claudeStates(records, list, now, { doneMs: 60_000, staleMs: 60_000 });
    assert.equal(states.get('C:/dev/hub'), 'done');
    assert.equal(states.get('C:/dev/hub/.claude/worktrees/048-operacao'), 'waiting');
  });
});

describe('locations', () => {
  it('slugs branch names', () => {
    assert.equal(branchSlug('feat/login page'), 'feat-login-page');
    assert.equal(branchSlug('///'), 'worktree');
  });
  it('expands the template', () => {
    const root = path.resolve('/dev/hub');
    assert.equal(resolveLocation('${repoRoot}/.claude/worktrees/${branchSlug}', root, 'feat/x'), path.join(root, '.claude', 'worktrees', 'feat-x'));
    assert.equal(resolveLocation('${repoParent}/${repoName}.worktrees/${branchSlug}', root, 'a/b'), path.join(path.dirname(root), 'hub.worktrees', 'a-b'));
    assert.equal(resolveLocation('wt/${branch}', root, 'x'), path.join(root, 'wt', 'x'));
  });
});

describe('defaultBase and worktreeAddArgs', () => {
  it('prefers the configured base, then the main branch on the remote, then origin HEAD', () => {
    assert.equal(defaultBase({ configured: ' release/2 ', mainBranch: 'developer', remoteHasMain: true }), 'release/2');
    assert.equal(defaultBase({ mainBranch: 'developer', remoteHasMain: true }), 'origin/developer');
    assert.equal(defaultBase({ mainBranch: 'developer', remoteHasMain: false, originHead: 'origin/main' }), 'origin/main');
    assert.equal(defaultBase({ remoteHasMain: false }), 'HEAD');
  });
  it('checks out existing branches and creates new ones without tracking the base', () => {
    assert.deepEqual(worktreeAddArgs({ target: 't', branch: 'b', base: 'origin/developer', localExists: true, remoteExists: false }), ['worktree', 'add', 't', 'b']);
    assert.deepEqual(worktreeAddArgs({ target: 't', branch: 'b', base: 'origin/developer', localExists: false, remoteExists: false }), ['worktree', 'add', '--no-track', '-b', 'b', 't', 'origin/developer']);
  });
});

describe('cleanupCandidate', () => {
  const w: Worktree = { path: '/r/.claude/worktrees/x', branch: 'feat/x', bare: false, locked: false, prunable: false, main: false };
  const base: CleanupInput = { worktree: w, current: false, claude: 'idle', merged: false, gone: false, ageDays: 5, lastCommitDays: 1, baseBranches: ['origin/main', 'developer'] };

  it('never offers the main worktree or the current one', () => {
    assert.equal(cleanupCandidate({ ...base, merged: true, worktree: { ...w, main: true } }, 14), undefined);
    assert.equal(cleanupCandidate({ ...base, merged: true, current: true }, 14), undefined);
  });
  it('suggests merged and gone branches', () => {
    assert.deepEqual(cleanupCandidate({ ...base, merged: true }, 14)?.suggested, true);
    assert.deepEqual(cleanupCandidate({ ...base, gone: true }, 14)?.reasons, ['gone']);
  });
  it('does not mistake a fresh branch with no commits for a merged one', () => {
    assert.equal(cleanupCandidate({ ...base, merged: true, ageDays: 0.1 }, 14), undefined);
  });
  it('does not offer a worktree on a base branch as merged', () => {
    assert.equal(cleanupCandidate({ ...base, merged: true, worktree: { ...w, branch: 'main' } }, 14), undefined);
    assert.equal(cleanupCandidate({ ...base, merged: true, worktree: { ...w, branch: 'developer' } }, 14), undefined);
  });
  it('lists stale work without pre-selecting it', () => {
    const c = cleanupCandidate({ ...base, lastCommitDays: 30 }, 14);
    assert.deepEqual([c?.reasons, c?.suggested], [['stale'], false]);
  });
  it('protects uncommitted changes and active Claude sessions', () => {
    const dirty = cleanupCandidate({ ...base, merged: true, changes: 3 }, 14);
    assert.deepEqual([dirty?.suggested, dirty?.warning], [false, '3 uncommitted changes would be lost']);
    assert.equal(cleanupCandidate({ ...base, gone: true, claude: 'waiting' }, 14)?.suggested, false);
  });
  it('suggests worktrees whose folder is gone', () => {
    assert.equal(cleanupCandidate({ ...base, worktree: { ...w, prunable: true } }, 14)?.suggested, true);
  });
});

describe('colorForName', () => {
  it('is stable and readable', () => {
    assert.equal(colorForName('048-operacao'), colorForName('048-operacao'));
    assert.notEqual(colorForName('048-operacao'), colorForName('063-board-pr'));
    for (const name of ['a', 'feat-login', 'outbound-configuracoes', 'po-outbound']) {
      assert.ok(contrastRatio(colorForName(name), '#ffffff') >= 4.5, name);
    }
  });
});

describe('git helpers on a real repository', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-flair-git-'));
  const repo = path.join(dir, 'repo');
  const remote = path.join(dir, 'remote.git');
  const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.mkdirSync(repo);
  run(dir, 'init', '--bare', '-b', 'main', remote);
  run(repo, 'init', '-b', 'main');
  run(repo, 'config', 'user.email', 't@t');
  run(repo, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  run(repo, 'add', '.');
  run(repo, 'commit', '-m', 'init');
  run(repo, 'remote', 'add', 'origin', remote);
  run(repo, 'push', '-u', 'origin', 'main');
  run(repo, 'remote', 'set-head', 'origin', 'main');
  // A merged branch, and a pushed branch whose remote copy is deleted later (a merged PR).
  run(repo, 'branch', 'merged-one');
  run(repo, 'checkout', '-b', 'pr-branch');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b');
  run(repo, 'add', '.');
  run(repo, 'commit', '-m', 'pr');
  run(repo, 'push', '-u', 'origin', 'pr-branch');
  run(repo, 'checkout', 'main');
  run(repo, 'push', 'origin', '--delete', 'pr-branch');
  run(repo, 'fetch', '--prune');
  run(repo, 'worktree', 'add', path.join(repo, '.claude', 'worktrees', 'merged-one'), 'merged-one');

  it('lists worktrees nested in the repository', () => {
    const list = parseWorktreeList(run(repo, 'worktree', 'list', '--porcelain'));
    assert.deepEqual(list.map((w) => w.branch), ['main', 'merged-one']);
  });

  it('finds the default branch, merged branches and deleted upstreams', async () => {
    const base = await defaultBranch(repo);
    assert.equal(base, 'origin/main');
    const info = await branchInfo(repo, await mergeBases(repo, 'main'));
    assert.ok(info.merged.has('merged-one'));
    assert.ok(!info.merged.has('pr-branch'));
    assert.ok(info.gone.has('pr-branch'));
  });

  it('treats the main worktree branch as a merge base too', async () => {
    run(repo, 'checkout', '-b', 'developer');
    run(repo, 'merge', '--no-ff', '-m', 'merge pr', 'pr-branch');
    const bases = await mergeBases(repo, 'developer');
    assert.deepEqual(bases, ['origin/main', 'developer']);
    assert.ok((await branchInfo(repo, bases)).merged.has('pr-branch'));
    const prHead = run(repo, 'rev-parse', 'pr-branch').trim();
    assert.equal(await isAncestor(repo, prHead, ['origin/main']), false);
    assert.equal(await isAncestor(repo, prHead, bases), true);
    run(repo, 'checkout', 'main');
  });

  it('starts a new task from the shared base, not from an agent worktree, and leaves that worktree untouched', async () => {
    // An agent is mid-task in its own worktree: one commit plus an uncommitted edit.
    const agentPath = path.join(repo, '.claude', 'worktrees', 'agent-task');
    run(repo, 'worktree', 'add', '-b', 'agent-task', agentPath, 'main');
    fs.writeFileSync(path.join(agentPath, 'agent.txt'), 'committed');
    run(agentPath, 'add', '.');
    run(agentPath, 'commit', '-m', 'agent work');
    fs.writeFileSync(path.join(agentPath, 'agent.txt'), 'uncommitted edit');
    const agentHead = run(agentPath, 'rev-parse', 'HEAD').trim();

    const base = defaultBase({ mainBranch: 'main', remoteHasMain: true });
    assert.equal(base, 'origin/main');
    assert.equal(await fetchBase(repo, base), true);
    const target = path.join(repo, '.claude', 'worktrees', 'new-task');
    run(repo, ...worktreeAddArgs({ target, branch: 'new-task', base, localExists: false, remoteExists: false }));

    assert.equal(run(target, 'rev-parse', 'HEAD').trim(), run(repo, 'rev-parse', 'origin/main').trim());
    assert.equal(fs.existsSync(path.join(target, 'agent.txt')), false, 'no agent commits inherited');
    assert.throws(() => run(target, 'rev-parse', '--abbrev-ref', 'new-task@{upstream}'), 'does not track the base');
    assert.equal(run(agentPath, 'rev-parse', 'HEAD').trim(), agentHead);
    assert.equal(fs.readFileSync(path.join(agentPath, 'agent.txt'), 'utf8'), 'uncommitted edit', 'agent edits intact');
  });

  it('lists branches without the remote HEAD alias', async () => {
    const branches = await listBranches(repo);
    assert.ok(branches.includes('main') && branches.includes('origin/main'));
    assert.ok(!branches.includes('origin') && !branches.includes('origin/HEAD'));
  });

  it('excludes nested worktree folders locally', async () => {
    assert.equal(await isIgnored(repo, '.claude/worktrees/x'), false);
    await addLocalExclude(repo, '/.claude/worktrees/');
    await addLocalExclude(repo, '/.claude/worktrees/');
    assert.equal(await isIgnored(repo, '.claude/worktrees/x'), true);
    const exclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
    assert.equal(exclude.split('\n').filter((l) => l === '/.claude/worktrees/').length, 1);
  });
});
