export type ChecksState = 'passing' | 'failing' | 'pending' | 'none';

export interface PullRequest {
  number: number;
  title: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  url: string;
  isDraft?: boolean;
  headRefName?: string;
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | '' | null;
  statusCheckRollup?: RollupEntry[];
}

/** One entry of `statusCheckRollup`: a check run or a commit status. */
export interface RollupEntry {
  __typename?: string;
  name?: string;
  context?: string;
  workflowName?: string;
  status?: string;
  conclusion?: string;
  state?: string;
  startedAt?: string;
  detailsUrl?: string;
  targetUrl?: string;
}

export interface Issue {
  number: number;
  title: string;
  state: string;
  url: string;
}

export interface ChecksSummary {
  state: ChecksState;
  passing: number;
  failing: number;
  pending: number;
  failed: { name: string; url?: string }[];
}

const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);
const PENDING = new Set(['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED']);

function outcome(e: RollupEntry): 'passing' | 'failing' | 'pending' {
  if (e.__typename === 'StatusContext' || (e.state && !e.status)) {
    const s = (e.state ?? '').toUpperCase();
    return FAILED.has(s) ? 'failing' : PENDING.has(s) ? 'pending' : 'passing';
  }
  if ((e.status ?? '').toUpperCase() !== 'COMPLETED') {
    return 'pending';
  }
  return FAILED.has((e.conclusion ?? '').toUpperCase()) ? 'failing' : 'passing';
}

/** Counts checks, keeping only the latest run of each check (re-runs replace earlier ones). */
export function summarizeChecks(entries: RollupEntry[] | undefined): ChecksSummary {
  const latest = new Map<string, RollupEntry>();
  for (const e of entries ?? []) {
    const key = `${e.workflowName ?? ''}/${e.name ?? e.context ?? ''}`;
    const prev = latest.get(key);
    if (!prev || (e.startedAt ?? '') >= (prev.startedAt ?? '')) {
      latest.set(key, e);
    }
  }
  const summary: ChecksSummary = { state: 'none', passing: 0, failing: 0, pending: 0, failed: [] };
  for (const e of latest.values()) {
    const o = outcome(e);
    summary[o]++;
    if (o === 'failing') {
      summary.failed.push({ name: e.name ?? e.context ?? 'check', url: e.detailsUrl ?? e.targetUrl });
    }
  }
  summary.state = summary.failing ? 'failing' : summary.pending ? 'pending' : summary.passing ? 'passing' : 'none';
  return summary;
}

/** `feat/056-recuperacao` → 56. Branches without a leading number give undefined. */
export function issueNumberFromBranch(branch: string | undefined): number | undefined {
  const m = branch ? /(?:^|\/)0*(\d{1,6})(?=[-_./]|$)/.exec(branch) : null;
  const n = m ? Number(m[1]) : NaN;
  return n > 0 ? n : undefined;
}

/** The PR a branch most likely belongs to: an open one, else the most recent. */
export function prForBranch(prs: PullRequest[], branch: string): PullRequest | undefined {
  const matching = prs.filter((p) => p.headRefName === branch);
  return matching.find((p) => p.state === 'OPEN') ?? matching.sort((a, b) => b.number - a.number)[0];
}

export function prIcon(pr: PullRequest): string {
  if (pr.state === 'MERGED') {
    return '$(git-merge)';
  }
  if (pr.state === 'CLOSED') {
    return '$(git-pull-request-closed)';
  }
  return pr.isDraft ? '$(git-pull-request-draft)' : '$(git-pull-request)';
}

export function checksIcon(state: ChecksState): string {
  return { passing: '$(check)', failing: '$(x)', pending: '$(sync~spin)', none: '' }[state];
}

export function prStateLabel(pr: PullRequest): string {
  if (pr.state !== 'OPEN') {
    return pr.state.toLowerCase();
  }
  return pr.isDraft ? 'draft' : 'open';
}

export function reviewLabel(decision: PullRequest['reviewDecision']): string | undefined {
  return decision === 'APPROVED' ? 'approved' : decision === 'CHANGES_REQUESTED' ? 'changes requested' : decision === 'REVIEW_REQUIRED' ? 'review required' : undefined;
}
