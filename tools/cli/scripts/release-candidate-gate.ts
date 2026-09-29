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
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { z } from 'zod';

/** Answers a REST path, or null for a 404. Artifact ZIPs are validated and
 * decoded into their sole release-candidate.json by the real adapter. */
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
 *   advance beyond that release. Choose again explicitly; never move a tag.
 */
export type GateState =
  | 'eligible'
  | 'pending'
  | 'blocked'
  | 'allocated'
  | 'conflict';

/** All source checks are required. One candidate event starts the complete
 * existing graph, including workflows normally filtered by changed paths. */
export const REQUIRED_WORKFLOWS = [
  '.github/workflows/checks.yml',
  '.github/workflows/sast.yml',
  '.github/workflows/commitlint.yml',
  '.github/workflows/e2e.yml',
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
const SOURCE_JOB = 'Candidate source / Resolve source';
const RECEIPT_JOB = 'Candidate gate / Record receipt';
export const IMAGE_SERVICES = [
  'db',
  'platform',
  'proxy',
  'sandbox-llm-gateway',
  'sandbox',
  'sandbox-egress',
  'sandbox-buildkitd',
  'sandbox-runtime',
] as const;
/** Held to the actual workflow graphs by release-candidate-workflows.test.ts. */
export const CANDIDATE_JOBS: Record<
  string,
  { ids: string[]; names: string[] }
> = {
  build: {
    ids: [
      'candidate-source',
      'changes',
      'build',
      'smoke-test',
      'image-validate',
      'web-test',
      'docs-test',
      'ui-docs-test',
      'ai-gateway-test',
      'storybook',
    ],
    names: [
      SOURCE_JOB,
      'Detect changes',
      ...IMAGE_SERVICES.map((service) => `Build ${service}`),
      'Smoke test',
      'Validate images',
      'Web container test',
      'Docs container test',
      'UI docs container test',
      'AI gateway container test',
      'Storybook',
      CANDIDATE_GATE_JOB,
    ],
  },
  checks: {
    ids: [
      'candidate-source',
      'format',
      'lint',
      'typecheck',
      'build',
      'test',
      'test-ui',
      'knip',
      'test-browser',
    ],
    names: [
      SOURCE_JOB,
      'Format',
      'Lint',
      'Type check',
      'Build',
      'Unit',
      'UI',
      'Knip',
      'Browser',
      RECEIPT_JOB,
    ],
  },
  sast: {
    ids: ['candidate-source', 'sast'],
    names: [SOURCE_JOB, 'Opengrep', RECEIPT_JOB],
  },
  commitlint: {
    ids: ['candidate-source', 'commitlint'],
    names: [SOURCE_JOB, 'Lint commits', RECEIPT_JOB],
  },
  e2e: {
    ids: ['candidate-source', 'build', 'e2e', 'static-sites'],
    names: [
      SOURCE_JOB,
      'Build platform (E2E preview bundle)',
      ...Array.from(
        { length: 16 },
        (_, index) => `Playwright (platform ${index + 1}/16)`,
      ),
      'Playwright (web)',
      'Playwright (docs)',
      RECEIPT_JOB,
    ],
  },
  cli: {
    ids: ['candidate-source', 'prepare', 'build'],
    names: [
      SOURCE_JOB,
      'Prepare',
      ...['linux', 'linux-arm64', 'macos', 'macos-x64', 'windows'].map(
        (platform) => `Build (${platform})`,
      ),
      RECEIPT_JOB,
    ],
  },
  security: {
    ids: ['candidate-source', 'bun-audit', 'trivy-fs'],
    names: [SOURCE_JOB, 'Bun audit', 'Trivy filesystem scan', RECEIPT_JOB],
  },
};
const RUNS_PAGE_SIZE = 100;
const RUNS_MAX_PAGES = 10;
// Filtered Actions searches return at most 1,000 results. At that boundary,
// even a reported total of 1,000 cannot establish that no run was omitted.
const RUNS_SEARCH_CEILING = RUNS_PAGE_SIZE * RUNS_MAX_PAGES;

const SHA = /^[a-f0-9]{40}$/;
const VERSION = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;

const runSchema = z
  .object({
    id: z.number(),
    path: z.string(),
    event: z.string(),
    status: z.string().nullable(),
    conclusion: z.string().nullable(),
    display_title: z.string(),
    html_url: z.string(),
    run_attempt: z.number().int().positive().optional(),
    created_at: z.iso.datetime(),
    run_started_at: z.iso.datetime().nullish(),
    head_branch: z.string().nullable(),
    head_sha: z.string(),
  })
  .refine((run) => (run.run_attempt ?? 1) === 1 || run.run_started_at != null, {
    message: 'run_started_at is required to order a rerun',
  });
const runsSchema = z.object({
  total_count: z.number().int().nonnegative(),
  workflow_runs: z.array(runSchema),
});
const jobsSchema = z.object({
  total_count: z.number().int().nonnegative(),
  jobs: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
      status: z.string().nullable(),
      conclusion: z.string().nullable(),
      run_attempt: z.number().int().positive(),
    }),
  ),
});
const artifactsSchema = z.object({
  total_count: z.number().int().nonnegative(),
  artifacts: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
      expired: z.boolean(),
      size_in_bytes: z.number().int().positive(),
    }),
  ),
});
const receiptSchema = z.object({
  schemaVersion: z.literal(1),
  workflow: z.string(),
  candidate: z.string(),
  verdict: z.literal('passed'),
  run: z.object({
    id: z.string(),
    attempt: z.string(),
    url: z.string(),
    event: z.string(),
    workflowSha: z.string(),
    ref: z.string(),
    sha: z.string(),
  }),
  jobs: z.record(z.string(), z.string()),
  images: z.array(
    z.object({
      service: z.string(),
      image: z.string(),
      tag: z.string(),
      revision: z.string(),
      digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    }),
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
  createdAt: string;
  startedAt: string | null;
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
  /** Every candidate run for this SHA, newest attempt first; it decides. */
  validation: RunSummary[];
  receipt: { artifact: string; id: number } | null;
  checks: {
    workflow: string;
    run: RunSummary | null;
    receipt?: { artifact: string; id: number };
  }[];
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
    createdAt: run.created_at,
    startedAt: run.run_started_at ?? null,
    headBranch: run.head_branch,
    headSha: run.head_sha,
  };
}

function newestFirst(a: Run, b: Run): number {
  // A rerun keeps its original id and creation time. Only the current
  // attempt's start orders it against attempts of other runs. First runs
  // without a start time (for example, queued ones) use their creation time.
  return (
    Date.parse(b.run_started_at ?? b.created_at) -
      Date.parse(a.run_started_at ?? a.created_at) ||
    b.created_at.localeCompare(a.created_at) ||
    b.id - a.id
  );
}

/** Read complete run evidence before judging it. A rerun keeps its original
 * position in the listing, so finding a success is never a stopping point. */
async function readRuns(
  api: GitHubApi,
  path: string,
  blocked: string[],
): Promise<Run[] | null> {
  const runs: Run[] = [];
  const seen = new Set<number>();
  let total: number | undefined;
  const refuse = (detail: string) => {
    blocked.push(`incomplete workflow run evidence from ${path}: ${detail}`);
    return null;
  };
  for (let page = 1; page <= RUNS_MAX_PAGES; page++) {
    const parsed = runsSchema.safeParse(await api(`${path}&page=${page}`));
    if (!parsed.success) {
      return refuse(
        `page ${page} is missing or invalid (${parsed.error.issues[0]?.message})`,
      );
    }
    const response = parsed.data;
    total ??= response.total_count;
    if (total >= RUNS_SEARCH_CEILING) {
      return refuse('the 1,000-run search ceiling was reached');
    }
    if (response.total_count !== total) {
      return refuse(`the total changed while reading page ${page}; try again`);
    }
    if (
      response.workflow_runs.length !==
      Math.min(RUNS_PAGE_SIZE, total - runs.length)
    ) {
      return refuse(
        `page ${page} does not contain its expected number of runs`,
      );
    }
    for (const run of response.workflow_runs) {
      if (seen.has(run.id)) return refuse(`page ${page} repeats run ${run.id}`);
      seen.add(run.id);
      runs.push(run);
    }
    if (runs.length === total) return runs;
  }
  return refuse('the page limit was reached before the list was complete');
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
  workflow = CANDIDATE_WORKFLOW_PATH,
): Promise<boolean> {
  if (
    run.path !== workflow ||
    run.head_branch !== 'main' ||
    !SHA.test(run.head_sha)
  ) {
    blocked.push(
      `${run.html_url} is not a candidate validation from the main ${workflow === CANDIDATE_WORKFLOW_PATH ? 'Build' : workflow} workflow at a full source SHA`,
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

const stemOf = (workflow: string) =>
  workflow
    .split('/')
    .at(-1)!
    .replace(/\.yml$/, '');
export const candidateArtifactName = (
  workflow: string,
  sha: string,
  attempt: number,
) => `release-candidate-${stemOf(workflow)}-${sha}-attempt-${attempt}`;

async function candidateRuns(
  api: GitHubApi,
  repo: string,
  workflow: string,
  sha: string,
  blocked: string[],
) {
  const runs: Run[] = [];
  let complete = true;
  for (const event of workflow === CANDIDATE_WORKFLOW_PATH
    ? CANDIDATE_EVENTS
    : ['repository_dispatch']) {
    const page = await readRuns(
      api,
      `${repo}/actions/workflows/${stemOf(workflow)}.yml/runs?branch=main&event=${event}&per_page=${RUNS_PAGE_SIZE}`,
      blocked,
    );
    if (page === null) complete = false;
    else
      runs.push(
        ...page.filter(
          (run) => run.display_title === `Release candidate ${sha}`,
        ),
      );
  }
  return { runs: runs.sort(newestFirst), complete };
}

/** The workflows contain fewer than 100 jobs/artifacts per attempt. Refuse a
 * larger/incomplete response rather than silently treating page one as proof. */
function completeMetadata<T extends { id: number }>(total: number, rows: T[]) {
  return (
    total <= 100 &&
    total === rows.length &&
    new Set(rows.map((row) => row.id)).size === rows.length
  );
}

async function candidateEvidence(
  api: GitHubApi,
  repo: string,
  run: Run,
  sha: string,
  blocked: string[],
) {
  const attempt = run.run_attempt ?? 1;
  const stem = stemOf(run.path);
  const contract = CANDIDATE_JOBS[stem];
  if (!contract) throw new Error(`Unknown candidate workflow ${run.path}`);
  try {
    const listing = jobsSchema.parse(
      await api(
        `${repo}/actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`,
      ),
    );
    const jobs = listing.jobs;
    if (
      !completeMetadata(listing.total_count, jobs) ||
      new Set(jobs.map((job) => job.name)).size !== jobs.length ||
      jobs.some((job) => job.run_attempt !== attempt)
    ) {
      throw new Error('incomplete, duplicated or wrong-attempt job evidence');
    }
    const verdictName = stem === 'build' ? CANDIDATE_GATE_JOB : RECEIPT_JOB;
    if (
      !jobs.some(
        (job) =>
          job.name === verdictName &&
          job.status === 'completed' &&
          job.conclusion === 'success',
      )
    ) {
      blocked.push(`${run.html_url} has no successful ${verdictName} job`);
      return null;
    }
    for (const name of contract.names) {
      if (
        !jobs.some(
          (job) =>
            job.name === name &&
            job.status === 'completed' &&
            job.conclusion === 'success',
        )
      )
        throw new Error(`missing or unsuccessful required job ${name}`);
    }
    for (const job of jobs) {
      if (contract.names.includes(job.name)) continue;
      const conditional =
        (stem === 'cli' && job.name === 'Attach to release') ||
        (stem === 'build' &&
          (/^Scan(?: .*)?$/.test(job.name) ||
            ['Smoke test (fork PR)', 'Validate images (fork PR)'].includes(
              job.name,
            )));
      if (
        !conditional ||
        job.status !== 'completed' ||
        job.conclusion !== 'skipped'
      )
        throw new Error(
          `unexpected candidate job/result ${job.name}: ${job.conclusion}`,
        );
    }
    const artifacts = artifactsSchema.parse(
      await api(`${repo}/actions/runs/${run.id}/artifacts?per_page=100`),
    );
    if (!completeMetadata(artifacts.total_count, artifacts.artifacts))
      throw new Error('incomplete or duplicated artifact evidence');
    const artifactName = candidateArtifactName(run.path, sha, attempt);
    const matches = artifacts.artifacts.filter(
      (artifact) => artifact.name === artifactName,
    );
    if (matches.length === 0) {
      blocked.push(`${run.html_url} kept no candidate receipt`);
      return null;
    }
    if (matches.length !== 1) throw new Error('duplicate candidate receipt');
    const artifact = matches[0]!;
    if (artifact.expired) {
      blocked.push(
        `the candidate receipt of ${run.html_url} expired: validate ${sha} again`,
      );
      return null;
    }
    if (artifact.size_in_bytes > 1_048_576)
      throw new Error('candidate receipt archive exceeds 1 MiB');
    const receipt = receiptSchema.parse(
      await api(`${repo}/actions/artifacts/${artifact.id}/zip`),
    );
    if (
      receipt.workflow !== run.path ||
      receipt.candidate !== sha ||
      receipt.run.id !== String(run.id) ||
      receipt.run.attempt !== String(attempt) ||
      receipt.run.url !== run.html_url ||
      receipt.run.event !== run.event ||
      receipt.run.ref !== 'refs/heads/main' ||
      receipt.run.sha !== run.head_sha ||
      receipt.run.workflowSha !== run.head_sha
    )
      throw new Error(
        'candidate receipt does not bind this source, workflow and current run attempt',
      );
    if (
      Object.keys(receipt.jobs).toSorted().join('\n') !==
        contract.ids.toSorted().join('\n') ||
      Object.values(receipt.jobs).some((result) => result !== 'success')
    )
      throw new Error(
        'candidate receipt has an incomplete or unsuccessful job set',
      );
    const expectedImages = stem === 'build' ? [...IMAGE_SERVICES] : [];
    if (
      receipt.images
        .map((image) => image.service)
        .toSorted()
        .join('\n') !== expectedImages.toSorted().join('\n') ||
      receipt.images.some(
        (image) =>
          image.revision !== sha ||
          image.tag !== `candidate-sha-${sha}` ||
          image.image !==
            `ghcr.io/${repo.slice(6).toLowerCase()}/tale-${image.service}`,
      )
    )
      throw new Error(
        'candidate receipt has an incomplete or foreign image set',
      );
    // A rerun could have begun while the receipt was downloaded. Refuse the
    // changed view instead of approving a now-historical attempt.
    const current = runSchema.parse(
      await api(`${repo}/actions/runs/${run.id}`),
    );
    if (JSON.stringify(current) !== JSON.stringify(run))
      throw new Error(
        'candidate run changed while reading its evidence; read again',
      );
    return { artifact: artifact.name, id: artifact.id };
  } catch (error) {
    blocked.push(
      `${run.html_url} has invalid candidate evidence: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
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

  // Releases only move forward: a newer version on a later source commit
  // than the latest release. Ops identifies a deployment by its source SHA.
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
    } else if (tagSha === sha) {
      conflict.push(
        `${sha} is already published as ${tag}; choose a newer candidate`,
      );
    } else if (
      onMain !== 'missing' &&
      !contains(await compare(api, repo, tagSha, sha))
    ) {
      conflict.push(`${sha} does not contain the latest release ${tag}`);
    }
  }

  // Candidate dispatches run trusted workflow H against source C. Their
  // GitHub head_sha is H, so exact-C push listings cannot discover them.
  const candidates = await candidateRuns(
    api,
    repo,
    CANDIDATE_WORKFLOW_PATH,
    sha,
    reasons.blocked,
  );
  report.validation = candidates.runs.map(summary);
  const validation = candidates.runs[0];
  if (!validation) {
    if (candidates.complete)
      reasons.blocked.push(
        `no main-branch Release candidate run validated ${sha}: dispatch build.yml for it (.github/RELEASING.md)`,
      );
  } else if (
    candidates.complete &&
    (await trustedCandidateRun(api, repo, validation, reasons.blocked)) &&
    judge(validation, 'the candidate validation', reasons)
  ) {
    report.receipt = await candidateEvidence(
      api,
      repo,
      validation,
      sha,
      reasons.blocked,
    );
  }

  const onCommit = await readRuns(
    api,
    `${repo}/actions/runs?head_sha=${sha}&per_page=${RUNS_PAGE_SIZE}`,
    reasons.blocked,
  );
  for (const workflow of REQUIRED_WORKFLOWS) {
    const dispatched = await candidateRuns(
      api,
      repo,
      workflow,
      sha,
      reasons.blocked,
    );
    // A dispatch for another source may happen to have head_sha=C. It is
    // never normal-source evidence for C; only its candidate receipt binds it.
    // CLI manual dispatch checks out release_tag, whose source may differ
    // from head_sha; that publication path cannot validate candidate source.
    const normal =
      onCommit?.filter(
        (entry) =>
          entry.path === workflow &&
          entry.event !== 'repository_dispatch' &&
          !(
            workflow.endsWith('/cli.yml') && entry.event === 'workflow_dispatch'
          ),
      ) ?? [];
    const run = [...normal, ...dispatched.runs].sort(newestFirst)[0];
    const check: GateReport['checks'][number] = {
      workflow,
      run: run ? summary(run) : null,
    };
    report.checks.push(check);
    if (onCommit === null || !dispatched.complete) continue;
    if (!run) {
      reasons.blocked.push(`${workflow} never ran for ${sha}`);
      continue;
    }
    // Candidate success may recover an older cancelled push. A later failed
    // push/rerun still decides; candidate receipts never launder that failure.
    if (run.event === 'repository_dispatch') {
      if (
        (await trustedCandidateRun(
          api,
          repo,
          run,
          reasons.blocked,
          workflow,
        )) &&
        judge(run, workflow, reasons)
      ) {
        const receipt = await candidateEvidence(
          api,
          repo,
          run,
          sha,
          reasons.blocked,
        );
        if (receipt) check.receipt = receipt;
      }
    } else if (
      run.head_sha !== sha ||
      run.head_branch !== 'main' ||
      !['push', 'workflow_dispatch', 'schedule'].includes(run.event)
    ) {
      reasons.blocked.push(
        `${run.html_url} is not normal main-source evidence for ${sha}`,
      );
    } else judge(run, workflow, reasons);
  }

  report.reasons = [...conflict, ...reasons.blocked, ...reasons.pending];
  if (conflict.length > 0) report.state = 'conflict';
  else if (reasons.blocked.length > 0) report.state = 'blocked';
  else if (reasons.pending.length > 0) report.state = 'pending';
  return report;
}

async function commandBytes(args: string[], limit: number) {
  const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 60_000);
  const read = async (stream: ReadableStream<Uint8Array>, maximum: number) => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > maximum) {
          child.kill('SIGKILL');
          throw new Error('response exceeds its bounded read limit');
        }
        chunks.push(part.value);
      }
      return Buffer.concat(chunks);
    } finally {
      reader.releaseLock();
    }
  };
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      read(child.stdout, limit),
      read(child.stderr, 65_536),
    ]);
    return { code, stdout, stderr: stderr.toString() };
  } finally {
    clearTimeout(timeout);
    await child.exited;
  }
}

/** Use Python's maintained ZIP reader, never a handwritten archive parser or
 * extraction into the checkout. The sole bounded regular member is read only. */
export async function decodeCandidateArchive(
  archive: Uint8Array,
): Promise<unknown> {
  if (archive.byteLength > 1_048_576)
    throw new Error('candidate archive exceeds 1 MiB');
  const directory = await mkdtemp(join(tmpdir(), 'tale-candidate-receipt-'));
  try {
    const path = join(directory, 'receipt.zip');
    await writeFile(path, archive);
    const result = await commandBytes(
      [
        'python3',
        '-c',
        `
import stat, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    members = archive.infolist()
    if len(members) != 1:
        raise ValueError('receipt archive must contain exactly one member')
    entry = members[0]
    mode = entry.external_attr >> 16
    if entry.filename != 'release-candidate.json' or entry.is_dir() or stat.S_IFMT(mode) not in (0, stat.S_IFREG):
        raise ValueError('receipt archive member must be the regular release-candidate.json')
    if entry.flag_bits & 1 or not 0 < entry.file_size <= 65536:
        raise ValueError('receipt member is encrypted, empty or exceeds 64 KiB')
    with archive.open(entry) as member:
        body = member.read(65537)
    if len(body) > 65536:
        raise ValueError('receipt member exceeds its bounded read limit')
    sys.stdout.buffer.write(body)
`,
        path,
      ],
      65_536,
    );
    if (result.code !== 0)
      throw new Error(`invalid candidate archive: ${result.stderr.trim()}`);
    return JSON.parse(result.stdout.toString());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** `gh api`, with a 404 answered as null and artifact ZIPs read separately. */
async function ghApi(path: string): Promise<unknown> {
  const archive = path.endsWith('/zip');
  const { code, stdout, stderr } = await commandBytes(
    ['gh', 'api', path],
    archive ? 1_048_576 : 8_388_608,
  );
  if (code === 0)
    return archive
      ? decodeCandidateArchive(stdout)
      : JSON.parse(stdout.toString());
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
