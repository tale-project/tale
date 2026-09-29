/**
 * The release lane's publish gate (.github/RELEASING.md): may `vX.Y.Z` be
 * tagged at this exact commit on main, now? It reads GitHub and nothing else —
 * it never tags, dispatches, re-runs or cancels — and it answers for the SHA
 * it is given, never for a newer head of main.
 *
 * Run: bun tools/cli/scripts/release-candidate-gate.ts --sha <full sha> --version vX.Y.Z
 *
 * Prints a JSON report and exits 0 only when the state is `eligible`; every
 * other state exits 1 with its reasons, and bad arguments exit 2. Uses `gh`,
 * authenticated as usual (GH_TOKEN); it needs read access only.
 */
import { parseArgs } from 'node:util';

import { z } from 'zod';

/** Answers a REST path relative to the API root, or null for a 404. */
export type GitHubApi = (path: string) => Promise<unknown>;

/**
 * - `eligible`: every check passed; the tag may be pushed at the candidate.
 * - `pending`: a required run is still going; ask again when it ends.
 * - `blocked`: a required run is missing, failed, skipped or was cancelled;
 *   validating again or re-running it can still clear it.
 * - `allocated`: a version tag already points at the candidate; reconcile
 *   that tag's Release run instead of tagging again. This says nothing about
 *   whether its images or GitHub release were published successfully.
 * - `conflict`: this pair can never pass — the version is taken or not newer
 *   than the latest release, or the commit is not on main or does not
 *   contain that release. Choose again explicitly; never move a tag.
 */
export type GateState =
  | 'eligible'
  | 'pending'
  | 'blocked'
  | 'allocated'
  | 'conflict';

/** Workflows whose latest run on the candidate commit must have succeeded:
 * the checks every push to main runs, and the E2E run dispatched for it. */
export const REQUIRED_WORKFLOWS = [
  '.github/workflows/checks.yml',
  '.github/workflows/sast.yml',
  '.github/workflows/commitlint.yml',
  '.github/workflows/e2e.yml',
] as const;

/** Path-filtered workflows, required only when they ran for the candidate. */
export const REQUIRED_WHEN_RUN = [
  '.github/workflows/cli.yml',
  '.github/workflows/security.yml',
] as const;

/** build.yml names a candidate run after its SHA (`run-name`), and this job
 * is its verdict. The push run of the same commit does not count: path
 * filters skip checks there, and main merges cancel it. */
const CANDIDATE_WORKFLOW = 'build.yml';
const CANDIDATE_WORKFLOW_PATH = `.github/workflows/${CANDIDATE_WORKFLOW}`;
const CANDIDATE_EVENTS = ['workflow_dispatch', 'repository_dispatch'];
const CANDIDATE_GATE_JOB = 'Candidate gate';

const SHA = /^[a-f0-9]{40}$/;
const VERSION = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;

const runSchema = z.object({
  id: z.number(),
  path: z.string(),
  event: z.string(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  display_title: z.string(),
  html_url: z.string(),
  run_attempt: z.number().optional(),
  created_at: z.string(),
  head_branch: z.string().nullable(),
  head_sha: z.string(),
});
const runsSchema = z.object({ workflow_runs: z.array(runSchema) });
const jobsSchema = z.object({
  jobs: z.array(
    z.object({
      name: z.string(),
      status: z.string().nullable(),
      conclusion: z.string().nullable(),
    }),
  ),
});
const artifactsSchema = z.object({
  artifacts: z.array(
    z.object({ id: z.number(), name: z.string(), expired: z.boolean() }),
  ),
});
const compareSchema = z.object({ status: z.string() });
const refSchema = z.object({
  object: z.object({ sha: z.string(), type: z.string() }),
});
const releaseSchema = z.object({ tag_name: z.string() });

type Run = z.infer<typeof runSchema>;

export type RunSummary = {
  url: string;
  event: string;
  status: string | null;
  conclusion: string | null;
  attempt: number | null;
  headBranch: string | null;
  headSha: string;
};

export type GateReport = {
  state: GateState;
  repository: string;
  candidate: string;
  version: string;
  /** The existing version reservation's commit and actual tag spelling. */
  tag: string | null;
  tagName: string | null;
  latestRelease: { tag: string; sha: string | null } | null;
  /** Every candidate run for this SHA, newest first; the newest decides. */
  validation: RunSummary[];
  receipt: { artifact: string; id: number } | null;
  checks: { workflow: string; run: RunSummary | null }[];
  reasons: string[];
};

export class UsageError extends Error {}

function summary(run: Run): RunSummary {
  return {
    url: run.html_url,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    attempt: run.run_attempt ?? null,
    headBranch: run.head_branch,
    headSha: run.head_sha,
  };
}

function newestFirst(a: Run, b: Run): number {
  return b.created_at.localeCompare(a.created_at) || b.id - a.id;
}

/** The commit a tag names (annotated tags dereferenced), or null. */
async function tagCommit(
  api: GitHubApi,
  repo: string,
  tag: string,
): Promise<string | null> {
  const found = await api(`${repo}/git/ref/tags/${tag}`);
  if (found === null) return null;
  const { object } = refSchema.parse(found);
  if (object.type === 'commit') return object.sha;
  const annotated = await api(`${repo}/git/tags/${object.sha}`);
  return annotated === null ? null : refSchema.parse(annotated).object.sha;
}

/** How `head` relates to `base`: `ahead` or `identical` when `base` is one
 * of its ancestors. */
async function compare(
  api: GitHubApi,
  repo: string,
  base: string,
  head: string,
): Promise<string> {
  const answer = await api(`${repo}/compare/${base}...${head}?per_page=1`);
  return answer === null ? 'missing' : compareSchema.parse(answer).status;
}

const contains = (status: string) =>
  status === 'ahead' || status === 'identical';

/** A matching title is not workflow provenance: a branch can carry a
 * different Build definition and still use the same title and job names.
 * Only the main workflow's full source commit counts, even after main moves. */
async function trustedCandidateRun(
  api: GitHubApi,
  repo: string,
  run: Run,
  blocked: string[],
): Promise<boolean> {
  if (
    run.path !== CANDIDATE_WORKFLOW_PATH ||
    run.head_branch !== 'main' ||
    !SHA.test(run.head_sha)
  ) {
    blocked.push(
      `${run.html_url} is not a candidate validation from the main Build workflow at a full source SHA`,
    );
    return false;
  }
  if (!contains(await compare(api, repo, run.head_sha, 'main'))) {
    blocked.push(
      `${run.html_url} used workflow source ${run.head_sha}, which is not a commit on main`,
    );
    return false;
  }
  return true;
}

/** Judge one run the release needs: success passes, a run still going is
 * pending, and any other conclusion — skipped and cancelled included —
 * blocks. */
function judge(
  run: Run,
  label: string,
  reasons: { blocked: string[]; pending: string[] },
): boolean {
  if (run.status !== 'completed') {
    reasons.pending.push(`${label} ${run.html_url} is ${run.status}`);
    return false;
  }
  if (run.conclusion !== 'success') {
    reasons.blocked.push(
      `${label} ${run.html_url} concluded ${run.conclusion ?? 'without a conclusion'}`,
    );
    return false;
  }
  return true;
}

export async function gate({
  sha,
  version,
  repository = 'tale-project/tale',
  api,
}: {
  sha: string;
  version: string;
  repository?: string;
  api: GitHubApi;
}): Promise<GateReport> {
  if (!SHA.test(sha)) {
    throw new UsageError('--sha must be a full 40-character commit SHA');
  }
  if (!VERSION.test(version)) {
    throw new UsageError('--version must be an exact version like v1.2.3');
  }
  if (!REPOSITORY.test(repository)) {
    throw new UsageError('--repo must be owner/name');
  }
  const repo = `repos/${repository}`;
  const report: GateReport = {
    state: 'eligible',
    repository,
    candidate: sha,
    version,
    tag: null,
    tagName: null,
    latestRelease: null,
    validation: [],
    receipt: null,
    checks: [],
    reasons: [],
  };

  // Both accepted tag spellings publish the same image version. Check all
  // reservations before reconciling one: a conflicting alias must not hide
  // behind the requested tag already pointing at the candidate.
  const reservations = await Promise.all(
    [version, version.slice(1)].map(async (tag) => ({
      tag,
      sha: await tagCommit(api, repo, tag),
    })),
  );
  const taken = reservations.find(
    (entry) => entry.sha !== null && entry.sha !== sha,
  );
  if (taken) {
    report.tag = taken.sha;
    report.tagName = taken.tag;
    report.state = 'conflict';
    report.reasons.push(
      `${taken.tag} already points at ${taken.sha}; a tag is never moved or reused`,
    );
    return report;
  }
  const allocated = reservations.find((entry) => entry.sha === sha);
  if (allocated) {
    report.tag = allocated.sha;
    report.tagName = allocated.tag;
    report.state = 'allocated';
    report.reasons.push(
      `${allocated.tag} already points at ${sha}: reconcile its Release run, never tag it again`,
    );
    return report;
  }

  const conflict: string[] = [];
  const reasons = { blocked: [] as string[], pending: [] as string[] };

  const onMain = await compare(api, repo, sha, 'main');
  if (onMain === 'missing') {
    conflict.push(`${sha} is not a commit of ${repository}`);
  } else if (!contains(onMain)) {
    conflict.push(`${sha} is not a commit on main (compare: ${onMain})`);
  }

  // Releases only move forward: a newer version, on a commit that contains
  // the latest release (release.yml moves `latest` to every release).
  const latest = await api(`${repo}/releases/latest`);
  if (latest !== null) {
    const tag = releaseSchema.parse(latest).tag_name;
    const tagSha = await tagCommit(api, repo, tag);
    report.latestRelease = { tag, sha: tagSha };
    if (Bun.semver.order(version.slice(1), tag.replace(/^v/, '')) <= 0) {
      conflict.push(`${version} is not newer than the latest release ${tag}`);
    }
    if (tagSha === null) {
      conflict.push(`the latest release ${tag} has no tag to compare with`);
    } else if (
      onMain !== 'missing' &&
      !contains(await compare(api, repo, tagSha, sha))
    ) {
      conflict.push(`${sha} does not contain the latest release ${tag}`);
    }
  }

  // The candidate validation: the newest Build run dispatched for this SHA.
  // Earlier runs stay in the report, so a failure that a retry followed
  // remains visible.
  const candidates: Run[] = [];
  for (const event of CANDIDATE_EVENTS) {
    const page = await api(
      `${repo}/actions/workflows/${CANDIDATE_WORKFLOW}/runs?branch=main&event=${event}&per_page=100`,
    );
    if (page === null) continue;
    candidates.push(
      ...runsSchema
        .parse(page)
        .workflow_runs.filter(
          (run) => run.display_title === `Release candidate ${sha}`,
        ),
    );
  }
  candidates.sort(newestFirst);
  report.validation = candidates.map(summary);
  const validation = candidates[0];
  if (!validation) {
    reasons.blocked.push(
      `no main-branch Release candidate run validated ${sha}: dispatch build.yml for it (.github/RELEASING.md)`,
    );
  } else if (
    (await trustedCandidateRun(api, repo, validation, reasons.blocked)) &&
    judge(validation, 'the candidate validation', reasons)
  ) {
    const jobs = jobsSchema.parse(
      await api(
        `${repo}/actions/runs/${validation.id}/jobs?filter=latest&per_page=100`,
      ),
    ).jobs;
    const verdict = jobs.find((job) => job.name === CANDIDATE_GATE_JOB);
    if (verdict?.conclusion !== 'success') {
      reasons.blocked.push(
        `${validation.html_url} has no successful ${CANDIDATE_GATE_JOB} job`,
      );
    }
    const artifact = artifactsSchema
      .parse(
        await api(
          `${repo}/actions/runs/${validation.id}/artifacts?per_page=100`,
        ),
      )
      .artifacts.find((entry) => entry.name === `release-candidate-${sha}`);
    if (!artifact) {
      reasons.blocked.push(`${validation.html_url} kept no candidate receipt`);
    } else if (artifact.expired) {
      reasons.blocked.push(
        `the candidate receipt of ${validation.html_url} expired: validate ${sha} again`,
      );
    } else {
      report.receipt = { artifact: artifact.name, id: artifact.id };
    }
  }

  // The other checks of the same commit: the newest run of each decides.
  const page = await api(`${repo}/actions/runs?head_sha=${sha}&per_page=100`);
  const onCommit = page === null ? [] : runsSchema.parse(page).workflow_runs;
  for (const workflow of [...REQUIRED_WORKFLOWS, ...REQUIRED_WHEN_RUN]) {
    const run = onCommit
      .filter((entry) => entry.path === workflow)
      .sort(newestFirst)[0];
    report.checks.push({ workflow, run: run ? summary(run) : null });
    if (run) judge(run, workflow, reasons);
    else if ((REQUIRED_WORKFLOWS as readonly string[]).includes(workflow)) {
      reasons.blocked.push(`${workflow} never ran for ${sha}`);
    }
  }

  report.reasons = [...conflict, ...reasons.blocked, ...reasons.pending];
  if (conflict.length > 0) report.state = 'conflict';
  else if (reasons.blocked.length > 0) report.state = 'blocked';
  else if (reasons.pending.length > 0) report.state = 'pending';
  return report;
}

/** `gh api`, with a 404 answered as null. */
async function ghApi(path: string): Promise<unknown> {
  const child = Bun.spawn(['gh', 'api', path], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code === 0) return JSON.parse(stdout);
  if (stderr.includes('(HTTP 404)')) return null;
  throw new Error(`gh api ${path} failed: ${stderr.trim()}`);
}

function usage(message: string): never {
  console.error(`release-candidate-gate: ${message}`);
  console.error(
    'usage: bun tools/cli/scripts/release-candidate-gate.ts --sha <full sha> --version vX.Y.Z [--repo owner/name]',
  );
  process.exit(2);
}

if (import.meta.main) {
  let options: { sha?: string; version?: string; repo?: string };
  try {
    options = parseArgs({
      options: {
        sha: { type: 'string' },
        version: { type: 'string' },
        repo: { type: 'string' },
      },
      strict: true,
    }).values;
  } catch (error) {
    usage(error instanceof Error ? error.message : String(error));
  }
  try {
    const report = await gate({
      sha: options.sha ?? '',
      version: options.version ?? '',
      repository: options.repo,
      api: ghApi,
    });
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.state === 'eligible' ? 0 : 1);
  } catch (error) {
    if (error instanceof UsageError) usage(error.message);
    throw error;
  }
}
