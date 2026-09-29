import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  gate,
  CANDIDATE_JOBS,
  IMAGE_SERVICES,
  candidateArtifactName,
  decodeCandidateArchive,
  type GitHubApi,
  REQUIRED_WORKFLOWS,
  UsageError,
} from './release-candidate-gate';

const CANDIDATE = 'c'.repeat(40);
const PREVIOUS = 'b'.repeat(40);
const ELSEWHERE = 'e'.repeat(40);
const WORKFLOW_SOURCE = 'd'.repeat(40);
const REPOSITORY = 'synthetic/tale';
const API_ROOT = `repos/${REPOSITORY}/`;

type Run = {
  id: number;
  path: string;
  event: string;
  status: string | null;
  conclusion: string | null;
  display_title: string;
  html_url: string;
  run_attempt: number;
  created_at: string;
  run_started_at?: string | null;
  head_branch: string | null;
  head_sha: string;
};

let nextRun = 100;
function run(
  path: string,
  conclusion: string | null,
  extra: Partial<Run> = {},
): Run {
  const id = nextRun++;
  return {
    id,
    path,
    event: 'push',
    status: conclusion === null ? 'in_progress' : 'completed',
    conclusion,
    display_title: 'fix: something',
    html_url: `https://github.com/${REPOSITORY}/actions/runs/${id}`,
    run_attempt: 1,
    created_at: `2026-09-29T19:${String(id % 60).padStart(2, '0')}:00Z`,
    head_branch: 'main',
    head_sha: CANDIDATE,
    ...extra,
  };
}

/** A Build run dispatched for the candidate (build.yml `run-name`). */
function candidateRun(
  conclusion: string | null,
  extra: Partial<Run> = {},
): Run {
  return run('.github/workflows/build.yml', conclusion, {
    event: 'workflow_dispatch',
    display_title: `Release candidate ${CANDIDATE}`,
    head_sha: WORKFLOW_SOURCE,
    ...extra,
  });
}

type Scenario = {
  tags: Record<string, { sha: string; annotated?: boolean }>;
  latestRelease: string | null;
  compare: Record<string, string>;
  candidateRuns: Run[];
  jobs: Record<number, { name: string; conclusion: string | null }[]>;
  artifacts: Record<number, { id: number; name: string; expired: boolean }[]>;
  commitRuns: Run[];
  runPageOverrides?: Record<string, unknown>;
  receiptOverrides?: Record<number, unknown>;
};

/** Everything the gate reads, for a candidate every check passed on. */
function passing(): Scenario {
  const validation = candidateRun('success');
  return {
    tags: { 'v0.5.63': { sha: PREVIOUS } },
    latestRelease: 'v0.5.63',
    compare: {
      [`${CANDIDATE}...main`]: 'ahead',
      [`${PREVIOUS}...${CANDIDATE}`]: 'ahead',
      [`${WORKFLOW_SOURCE}...main`]: 'ahead',
    },
    candidateRuns: [validation],
    jobs: {
      [validation.id]: [
        ...CANDIDATE_JOBS.build!.names.map((name) => ({
          name,
          conclusion: 'success',
        })),
        { name: 'Smoke test (fork PR)', conclusion: 'skipped' },
      ],
    },
    artifacts: {
      [validation.id]: [
        {
          id: 7,
          name: candidateArtifactName(validation.path, CANDIDATE, 1),
          expired: false,
        },
      ],
    },
    commitRuns: [
      ...REQUIRED_WORKFLOWS.map((path) =>
        run(path, 'success', {
          event: path.endsWith('e2e.yml') ? 'workflow_dispatch' : 'push',
        }),
      ),
      // The push Build run main merges starved (#3951): not a candidate check.
      run('.github/workflows/build.yml', 'cancelled'),
      run('.github/workflows/scorecard.yml', 'failure'),
    ],
  };
}

/** The older run is attempted again after a newer run has completed. */
function rerunScenario(
  lane: 'candidate' | 'checks',
  conclusion: string | null,
  previousConclusion = 'success',
) {
  const scenario = passing();
  const path =
    lane === 'candidate'
      ? '.github/workflows/build.yml'
      : '.github/workflows/checks.yml';
  const make = lane === 'candidate' ? candidateRun : run.bind(null, path);
  const retried = make(conclusion, {
    created_at: '2026-09-29T19:00:00Z',
    run_started_at: '2026-09-29T21:00:00Z',
    run_attempt: 2,
  });
  const newer = make(previousConclusion, {
    created_at: '2026-09-29T20:00:00Z',
    run_started_at: '2026-09-29T20:00:00Z',
  });
  if (lane === 'candidate') {
    const initial = scenario.candidateRuns[0]!;
    scenario.candidateRuns = [newer, retried];
    for (const entry of scenario.candidateRuns) {
      scenario.jobs[entry.id] = scenario.jobs[initial.id]!;
      scenario.artifacts[entry.id] = [
        {
          id: entry.id,
          name: candidateArtifactName(entry.path, CANDIDATE, entry.run_attempt),
          expired: false,
        },
      ];
    }
  } else {
    scenario.commitRuns = [
      ...scenario.commitRuns.filter((entry) => entry.path !== path),
      newer,
      retried,
    ];
  }
  return { scenario, retried };
}

function pagedRerunScenario(
  lane: 'candidate' | 'checks',
  count = 101,
  conclusion = 'failure',
  previousConclusion = 'success',
) {
  const { scenario, retried } = rerunScenario(
    lane,
    conclusion,
    previousConclusion,
  );
  const rows =
    lane === 'candidate' ? scenario.candidateRuns : scenario.commitRuns;
  rows.splice(rows.indexOf(retried), 1);
  while (rows.length < count - 1) {
    rows.push(
      run(
        lane === 'candidate'
          ? '.github/workflows/build.yml'
          : '.github/workflows/scorecard.yml',
        'success',
        {
          event: lane === 'candidate' ? 'workflow_dispatch' : 'push',
          display_title: `Release candidate ${ELSEWHERE}`,
        },
      ),
    );
  }
  rows.push(retried);
  return { scenario, retried, rows };
}

function runListPath(lane: 'candidate' | 'checks') {
  return lane === 'candidate'
    ? 'actions/workflows/build.yml/runs?branch=main&event=workflow_dispatch&per_page=100'
    : `actions/runs?head_sha=${CANDIDATE}&per_page=100`;
}

function fakeApi(scenario: Scenario) {
  const calls: string[] = [];
  const api: GitHubApi = async (path) => {
    calls.push(path);
    if (!path.startsWith(API_ROOT))
      throw new Error(`outside the repo: ${path}`);
    const rest = path.slice(API_ROOT.length);
    if (Object.hasOwn(scenario.runPageOverrides ?? {}, rest))
      return scenario.runPageOverrides![rest];
    let match: RegExpMatchArray | null;
    if ((match = rest.match(/^actions\/runs\/(\d+)$/)))
      return (
        scenario.candidateRuns.find(
          (entry) => entry.id === Number(match![1]),
        ) ?? null
      );
    if ((match = rest.match(/^git\/ref\/tags\/(.+)$/))) {
      const tag = scenario.tags[match[1]!];
      if (!tag) return null;
      return tag.annotated
        ? { object: { sha: `tag-object-${match[1]}`, type: 'tag' } }
        : { object: { sha: tag.sha, type: 'commit' } };
    }
    if ((match = rest.match(/^git\/tags\/tag-object-(.+)$/))) {
      const tag = scenario.tags[match[1]!];
      return tag ? { object: { sha: tag.sha, type: 'commit' } } : null;
    }
    if (rest === 'releases/latest') {
      return scenario.latestRelease
        ? { tag_name: scenario.latestRelease }
        : null;
    }
    if ((match = rest.match(/^compare\/(.+)\?per_page=1$/))) {
      const status = scenario.compare[match[1]!];
      return status ? { status } : null;
    }
    if (
      (match = rest.match(
        /^actions\/workflows\/(\w+)\.yml\/runs\?branch=main&event=(\w+)&per_page=100(?:&page=(\d+))?$/,
      ))
    ) {
      const rows = scenario.candidateRuns.filter(
        (entry) =>
          entry.event === match![2] &&
          entry.path === `.github/workflows/${match![1]}.yml`,
      );
      const page = Number(match[3] ?? 1);
      return {
        total_count: rows.length,
        workflow_runs: rows.slice((page - 1) * 100, page * 100),
      };
    }
    if (
      (match = rest.match(
        /^actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs\?per_page=100$/,
      ))
    ) {
      const jobs = (scenario.jobs[Number(match[1])] ?? []).map(
        ({ name, conclusion }, index) => ({
          id: index + 1,
          name,
          conclusion,
          status: 'completed',
          run_attempt: Number(match![2]),
        }),
      );
      return { total_count: jobs.length, jobs };
    }
    if (
      (match = rest.match(/^actions\/runs\/(\d+)\/artifacts\?per_page=100$/))
    ) {
      const artifacts = (scenario.artifacts[Number(match[1])] ?? []).map(
        ({ id, name, expired }) => ({ id, name, expired, size_in_bytes: 512 }),
      );
      return { total_count: artifacts.length, artifacts };
    }
    if ((match = rest.match(/^actions\/artifacts\/(\d+)\/zip$/))) {
      const id = Number(match[1]);
      if (Object.hasOwn(scenario.receiptOverrides ?? {}, id))
        return scenario.receiptOverrides![id];
      const owner = Object.entries(scenario.artifacts).find(([_key, rows]) =>
        rows.some((entry) => entry.id === id),
      );
      const record = scenario.candidateRuns.find(
        (entry) => entry.id === Number(owner?.[0]),
      );
      if (!record) return null;
      const stem = record.path.split('/').at(-1)!.replace('.yml', '');
      return {
        schemaVersion: 1,
        workflow: record.path,
        candidate: CANDIDATE,
        verdict: 'passed',
        run: {
          id: String(record.id),
          attempt: String(record.run_attempt),
          url: record.html_url,
          event: record.event,
          workflowSha: record.head_sha,
          ref: 'refs/heads/main',
          sha: record.head_sha,
        },
        jobs: Object.fromEntries(
          CANDIDATE_JOBS[stem]!.ids.map((key) => [key, 'success']),
        ),
        images:
          stem === 'build'
            ? IMAGE_SERVICES.map((service) => ({
                service,
                image: `ghcr.io/${REPOSITORY}/tale-${service}`,
                revision: CANDIDATE,
                tag: `candidate-sha-${CANDIDATE}`,
                digest: `sha256:${'a'.repeat(64)}`,
              }))
            : [],
      };
    }
    if (
      (match = rest.match(
        /^actions\/runs\?head_sha=([a-f0-9]{40})&per_page=100(?:&page=(\d+))?$/,
      ))
    ) {
      const rows = match[1] === CANDIDATE ? scenario.commitRuns : [];
      const page = Number(match[2] ?? 1);
      return {
        total_count: rows.length,
        workflow_runs: rows.slice((page - 1) * 100, page * 100),
      };
    }
    throw new Error(`unexpected call: ${path}`);
  };
  return { api, calls };
}

async function judge(scenario: Scenario, version = 'v0.5.64') {
  const { api, calls } = fakeApi(scenario);
  const report = await gate({
    sha: CANDIDATE,
    version,
    repository: REPOSITORY,
    api,
  });
  return { report, calls };
}

function dispatchedSources() {
  const scenario = passing();
  scenario.commitRuns = scenario.commitRuns.filter(
    (entry) =>
      !REQUIRED_WORKFLOWS.includes(
        entry.path as (typeof REQUIRED_WORKFLOWS)[number],
      ),
  );
  for (const path of REQUIRED_WORKFLOWS) {
    const validation = candidateRun('success', {
      path,
      event: 'repository_dispatch',
      created_at: '2026-09-29T21:00:00Z',
    });
    scenario.candidateRuns.push(validation);
    const stem = path.split('/').at(-1)!.replace('.yml', '');
    scenario.jobs[validation.id] = CANDIDATE_JOBS[stem]!.names.map((name) => ({
      name,
      conclusion: 'success',
    }));
    if (stem === 'cli')
      scenario.jobs[validation.id]!.push({
        name: 'Attach to release',
        conclusion: 'skipped',
      });
    scenario.artifacts[validation.id] = [
      {
        id: validation.id,
        name: candidateArtifactName(path, CANDIDATE, 1),
        expired: false,
      },
    ];
  }
  return scenario;
}

type ReceiptFixture = {
  schemaVersion: number;
  workflow: string;
  candidate: string;
  verdict: string;
  run: Record<string, string>;
  jobs: Record<string, string>;
  images: Record<string, string>[];
};
async function replaceReceipt(
  scenario: Scenario,
  stem: string,
  change: (receipt: ReceiptFixture) => void,
) {
  const entry = scenario.candidateRuns.find(
    (candidate) => candidate.path === `.github/workflows/${stem}.yml`,
  )!;
  const id = scenario.artifacts[entry.id]![0]!.id;
  const receipt = (await fakeApi(scenario).api(
    `${API_ROOT}actions/artifacts/${id}/zip`,
  )) as ReceiptFixture;
  change(receipt);
  scenario.receiptOverrides = { ...scenario.receiptOverrides, [id]: receipt };
  return entry;
}

describe('complete candidate event and receipt provenance', () => {
  test('all existing source workflows can validate C from trusted main H without an E2E push', async () => {
    const { report } = await judge(dispatchedSources());
    expect(report.reasons).toEqual([]);
    expect(report.state).toBe('eligible');
    expect(report.checks).toHaveLength(6);
    for (const check of report.checks) {
      expect(check.run).toMatchObject({
        event: 'repository_dispatch',
        headSha: WORKFLOW_SOURCE,
      });
      expect(check.receipt?.artifact).toBe(
        candidateArtifactName(check.workflow, CANDIDATE, 1),
      );
    }
  });

  test.each(['failure', 'cancelled', 'skipped', null] as const)(
    'the latest candidate E2E %s cannot be replaced by an older normal success',
    async (conclusion) => {
      const scenario = dispatchedSources();
      const entry = scenario.candidateRuns.find((candidate) =>
        candidate.path.endsWith('/e2e.yml'),
      )!;
      entry.conclusion = conclusion;
      entry.status = conclusion === null ? 'in_progress' : 'completed';
      scenario.commitRuns.push(
        run(entry.path, 'success', {
          event: 'schedule',
          created_at: '2026-09-29T20:00:00Z',
        }),
      );
      expect((await judge(scenario)).report.state).toBe(
        conclusion === null ? 'pending' : 'blocked',
      );
    },
  );

  test.each(['checks', 'sast', 'commitlint', 'e2e', 'cli', 'security'])(
    '%s: candidate success recovers an older cancelled source run, but a later failed source rerun still blocks',
    async (stem) => {
      const scenario = dispatchedSources();
      const normal = run(`.github/workflows/${stem}.yml`, 'cancelled', {
        created_at: '2026-09-29T20:00:00Z',
      });
      scenario.commitRuns.push(normal);
      expect((await judge(scenario)).report.state).toBe('eligible');
      normal.run_attempt = 2;
      normal.run_started_at = '2026-09-29T22:00:00Z';
      normal.conclusion = 'failure';
      const { report } = await judge(scenario);
      expect(report.state).toBe('blocked');
      expect(report.reasons).toContain(
        `${normal.path} ${normal.html_url} concluded failure`,
      );
    },
  );

  test('a repository dispatch for D with GitHub head C cannot masquerade as source-C evidence', async () => {
    const scenario = dispatchedSources();
    scenario.candidateRuns = scenario.candidateRuns.filter(
      (entry) => !entry.path.endsWith('/e2e.yml'),
    );
    scenario.commitRuns.push(
      candidateRun('success', {
        path: '.github/workflows/e2e.yml',
        event: 'repository_dispatch',
        head_sha: CANDIDATE,
        display_title: `Release candidate ${ELSEWHERE}`,
      }),
    );
    const { report } = await judge(scenario);
    expect(report.state).toBe('blocked');
    expect(report.reasons).toContain(
      `.github/workflows/e2e.yml never ran for ${CANDIDATE}`,
    );
  });

  test.each(['cli', 'security'])(
    '%s must run even when the old path-filtered workflow produced no evidence',
    async (stem) => {
      const scenario = dispatchedSources();
      const path = `.github/workflows/${stem}.yml`;
      scenario.candidateRuns = scenario.candidateRuns.filter(
        (entry) => entry.path !== path,
      );
      const { report } = await judge(scenario);
      expect(report.state).toBe('blocked');
      expect(report.reasons).toContain(`${path} never ran for ${CANDIDATE}`);
    },
  );

  test('a CLI tag-publication dispatch at workflow C cannot prove the tag source D was candidate C', async () => {
    const scenario = dispatchedSources();
    const path = '.github/workflows/cli.yml';
    scenario.candidateRuns = scenario.candidateRuns.filter(
      (entry) => entry.path !== path,
    );
    // cli.yml workflow_dispatch checks out release_tag, not GitHub's head_sha.
    // That tag may point at D; API run metadata cannot bind this build to C.
    scenario.commitRuns.push(
      run(path, 'success', { event: 'workflow_dispatch', head_sha: CANDIDATE }),
    );
    const { report } = await judge(scenario);
    expect(report.state).toBe('blocked');
    expect(report.reasons).toContain(`${path} never ran for ${CANDIDATE}`);
  });

  test.each(['head_branch', 'head_sha'] as const)(
    'candidate source workflow rejects foreign %s provenance',
    async (field) => {
      const scenario = dispatchedSources();
      scenario.candidateRuns.find((candidate) =>
        candidate.path.endsWith('/e2e.yml'),
      )![field] = field === 'head_branch' ? 'ci/unmerged' : 'short-sha';
      expect((await judge(scenario)).report.state).toBe('blocked');
    },
  );

  test.each([
    'candidate',
    'workflow',
    'verdict',
    'run.id',
    'run.attempt',
    'run.url',
    'run.event',
    'run.workflowSha',
    'run.ref',
    'run.sha',
    'jobs',
    'images',
    'schemaVersion',
  ])('receipt refuses a foreign or incomplete %s', async (field) => {
    const scenario = dispatchedSources();
    await replaceReceipt(scenario, 'e2e', (receipt) => {
      if (field.startsWith('run.')) receipt.run[field.slice(4)] = 'foreign';
      else if (field === 'jobs') delete receipt.jobs.e2e;
      else if (field === 'images') receipt.images.push({ service: 'foreign' });
      else if (field === 'schemaVersion') receipt.schemaVersion = 2;
      else receipt[field as 'candidate' | 'workflow' | 'verdict'] = 'foreign';
    });
    expect((await judge(scenario)).report.state).toBe('blocked');
  });

  test.each([
    'missing',
    'skipped',
    'failure',
    'cancelled',
    'duplicate',
    'unexpected',
  ])('a green E2E verdict cannot hide a %s shard', async (mode) => {
    const scenario = dispatchedSources();
    const entry = scenario.candidateRuns.find((candidate) =>
      candidate.path.endsWith('/e2e.yml'),
    )!;
    const name = 'Playwright (platform 16/16)';
    if (mode === 'missing')
      scenario.jobs[entry.id] = scenario.jobs[entry.id]!.filter(
        (job) => job.name !== name,
      );
    else if (mode === 'duplicate')
      scenario.jobs[entry.id]!.push({ name, conclusion: 'success' });
    else if (mode === 'unexpected')
      scenario.jobs[entry.id]!.push({
        name: 'New unreviewed gate',
        conclusion: 'skipped',
      });
    else
      scenario.jobs[entry.id]!.find((job) => job.name === name)!.conclusion =
        mode;
    expect((await judge(scenario)).report.state).toBe('blocked');
  });

  test.each([
    'old-artifact',
    'old-jobs',
    'partial-jobs',
    'partial-artifacts',
    'duplicate-artifact',
    'oversized-artifact',
    'moving-attempt',
  ])('incomplete or historical evidence (%s) is refused', async (mode) => {
    const scenario = dispatchedSources();
    const entry = scenario.candidateRuns.find((candidate) =>
      candidate.path.endsWith('/e2e.yml'),
    )!;
    const { api } = fakeApi(scenario);
    const jobsPath = `actions/runs/${entry.id}/attempts/1/jobs?per_page=100`;
    const artifactsPath = `actions/runs/${entry.id}/artifacts?per_page=100`;
    if (mode === 'old-artifact')
      scenario.artifacts[entry.id]![0]!.name = candidateArtifactName(
        entry.path,
        CANDIDATE,
        2,
      );
    else if (mode === 'moving-attempt')
      scenario.runPageOverrides = {
        [`actions/runs/${entry.id}`]: {
          ...entry,
          run_attempt: 2,
          run_started_at: '2026-09-29T22:00:00Z',
          status: 'in_progress',
          conclusion: null,
        },
      };
    else if (mode.includes('jobs')) {
      const listing = (await api(API_ROOT + jobsPath)) as {
        total_count: number;
        jobs: { run_attempt: number }[];
      };
      if (mode === 'old-jobs') listing.jobs[0]!.run_attempt = 2;
      else listing.total_count += 1;
      scenario.runPageOverrides = { [jobsPath]: listing };
    } else {
      const listing = (await api(API_ROOT + artifactsPath)) as {
        total_count: number;
        artifacts: { id: number; size_in_bytes: number }[];
      };
      if (mode === 'partial-artifacts') listing.total_count += 1;
      else if (mode === 'oversized-artifact')
        listing.artifacts[0]!.size_in_bytes = 1_048_577;
      else {
        listing.artifacts.push({ ...listing.artifacts[0]!, id: 999999 });
        listing.total_count += 1;
      }
      scenario.runPageOverrides = { [artifactsPath]: listing };
    }
    expect((await judge(scenario)).report.state).toBe('blocked');
  });

  test('source candidate pagination cannot hide the latest failed attempt on page two', async () => {
    const scenario = dispatchedSources();
    const path = '.github/workflows/e2e.yml';
    for (let index = 0; index < 99; index++)
      scenario.candidateRuns.push(
        candidateRun('success', {
          path,
          event: 'repository_dispatch',
          display_title: `Release candidate ${ELSEWHERE}`,
        }),
      );
    scenario.candidateRuns.push(
      candidateRun('failure', {
        path,
        event: 'repository_dispatch',
        created_at: '2026-09-29T19:00:00Z',
        run_started_at: '2026-09-29T23:00:00Z',
        run_attempt: 2,
      }),
    );
    const { report, calls } = await judge(scenario);
    expect(report.state).toBe('blocked');
    expect(calls).toContain(
      `${API_ROOT}actions/workflows/e2e.yml/runs?branch=main&event=repository_dispatch&per_page=100&page=2`,
    );
  });

  test.each(['missing', 'duplicate', 'foreign-source', 'wrong-digest'])(
    'Build digest receipt refuses %s image evidence',
    async (mode) => {
      const scenario = dispatchedSources();
      await replaceReceipt(scenario, 'build', (receipt) => {
        if (mode === 'missing') receipt.images.pop();
        else if (mode === 'duplicate') receipt.images.push(receipt.images[0]!);
        else if (mode === 'foreign-source')
          receipt.images[0]!.revision = ELSEWHERE;
        else receipt.images[0]!.digest = 'sha256:short';
      });
      expect((await judge(scenario)).report.state).toBe('blocked');
    },
  );
});

describe('bounded candidate archive reader', () => {
  const makeArchive = async (
    members: { name: string; text: string; mode?: number }[],
  ) => {
    const child = Bun.spawn(
      [
        'python3',
        '-c',
        `
import io,json,sys,zipfile
buffer=io.BytesIO()
with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for member in json.loads(sys.argv[1]):
        entry=zipfile.ZipInfo(member['name'])
        entry.external_attr=member.get('mode', 0o100644) << 16
        entry.compress_type=zipfile.ZIP_DEFLATED
        archive.writestr(entry, member['text'])
sys.stdout.buffer.write(buffer.getvalue())
`,
        JSON.stringify(members),
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [code, bytes, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).arrayBuffer(),
      new Response(child.stderr).text(),
    ]);
    expect(code, stderr).toBe(0);
    return new Uint8Array(bytes);
  };
  test.skipIf(process.platform === 'win32')(
    'one regular bounded JSON member is decoded without extraction',
    async () => {
      const body = { schemaVersion: 1, padding: 'x'.repeat(60_000) };
      expect(
        await decodeCandidateArchive(
          await makeArchive([
            { name: 'release-candidate.json', text: JSON.stringify(body) },
          ]),
        ),
      ).toEqual(body);
    },
  );
  const unsafeMembers: { name: string; text: string; mode?: number }[][] = [
    [
      { name: 'release-candidate.json', text: '{}' },
      { name: 'release-candidate.json', text: '{}' },
    ],
    [
      { name: 'release-candidate.json', text: '{}' },
      { name: 'unexpected.json', text: '{}' },
    ],
    [{ name: '../release-candidate.json', text: '{}' }],
    [{ name: 'release-candidate.json', text: '/etc/passwd', mode: 0o120777 }],
    [{ name: 'release-candidate.json/', text: '{}', mode: 0o40755 }],
    [{ name: 'release-candidate.json', text: 'x'.repeat(65_537) }],
    [{ name: 'release-candidate.json', text: '' }],
  ];
  test
    .skipIf(process.platform === 'win32')
    .each(unsafeMembers.map((members) => ({ members })))(
    'refuses an unsafe archive member set %#',
    async ({ members }) => {
      await expect(
        decodeCandidateArchive(await makeArchive(members)),
      ).rejects.toThrow();
    },
  );
  test('refuses a compressed archive beyond 1 MiB before parsing', async () => {
    await expect(
      decodeCandidateArchive(new Uint8Array(1_048_577)),
    ).rejects.toThrow('exceeds 1 MiB');
  });
  test.skipIf(process.platform === 'win32')(
    'refuses malformed ZIP bytes',
    async () => {
      await expect(
        decodeCandidateArchive(new Uint8Array([1, 2, 3])),
      ).rejects.toThrow('invalid candidate archive');
    },
  );
});

describe('release candidate gate', () => {
  test('a candidate whose validation and checks all passed may be tagged', async () => {
    const { report, calls } = await judge(passing());
    expect(report.reasons).toEqual([]);
    expect(report.state).toBe('eligible');
    expect(report.latestRelease).toEqual({ tag: 'v0.5.63', sha: PREVIOUS });
    expect(report.receipt).toEqual({
      artifact: candidateArtifactName(
        '.github/workflows/build.yml',
        CANDIDATE,
        1,
      ),
      id: 7,
    });
    expect(report.checks.map((check) => check.workflow)).toEqual([
      ...REQUIRED_WORKFLOWS,
    ]);
    expect(report.checks.at(-1)).toMatchObject({
      workflow: '.github/workflows/security.yml',
      run: { conclusion: 'success' },
    });
    // It only reads.
    expect(calls.every((call) => call.startsWith(API_ROOT))).toBe(true);
  });

  test('a repository-dispatched validation of the head of main counts too', async () => {
    const scenario = passing();
    scenario.compare[`${CANDIDATE}...main`] = 'identical';
    scenario.candidateRuns[0]!.event = 'repository_dispatch';
    expect((await judge(scenario)).report.state).toBe('eligible');
  });

  test('without a validation run for this exact SHA it is blocked', async () => {
    const scenario = passing();
    scenario.candidateRuns = [
      // Another candidate's run, and a title that only starts with the SHA.
      candidateRun('success', {
        display_title: `Release candidate ${ELSEWHERE}`,
      }),
      candidateRun('success', {
        display_title: `Release candidate ${CANDIDATE.slice(0, 7)}`,
      }),
    ];
    const { report } = await judge(scenario);
    expect(report.state).toBe('blocked');
    expect(report.validation).toEqual([]);
    expect(report.reasons).toEqual([
      `no main-branch Release candidate run validated ${CANDIDATE}: dispatch build.yml for it (.github/RELEASING.md)`,
    ]);
  });

  test.each([
    { head_branch: 'ci/unmerged-workflow' },
    { head_branch: null },
    { head_sha: WORKFLOW_SOURCE.slice(0, 7) },
    { path: '.github/workflows/other.yml' },
  ])(
    'a matching title and successful job cannot replace main workflow provenance: %j',
    async (change) => {
      const scenario = passing();
      Object.assign(scenario.candidateRuns[0]!, change);
      if ('path' in change)
        scenario.runPageOverrides = {
          [`${runListPath('candidate')}&page=1`]: {
            total_count: 1,
            workflow_runs: scenario.candidateRuns,
          },
        };
      const { report, calls } = await judge(scenario);
      expect(report.state).toBe('blocked');
      expect(report.receipt).toBeNull();
      expect(report.reasons).toEqual([
        `${scenario.candidateRuns[0]!.html_url} is not a candidate validation from the main Build workflow at a full source SHA`,
      ]);
      expect(calls.some((call) => call.includes('/artifacts?'))).toBe(false);
    },
  );

  test.each(['behind', 'diverged', 'missing'])(
    'workflow source no longer contained in main (%s) cannot validate the candidate',
    async (status) => {
      const scenario = passing();
      if (status === 'missing')
        delete scenario.compare[`${WORKFLOW_SOURCE}...main`];
      else scenario.compare[`${WORKFLOW_SOURCE}...main`] = status;
      const { report } = await judge(scenario);
      expect(report.state).toBe('blocked');
      expect(report.reasons).toEqual([
        `${scenario.candidateRuns[0]!.html_url} used workflow source ${WORKFLOW_SOURCE}, which is not a commit on main`,
      ]);
    },
  );

  test.each(['ahead', 'identical'])(
    'a pinned main workflow source remains valid while main moves (%s)',
    async (status) => {
      const scenario = passing();
      scenario.compare[`${WORKFLOW_SOURCE}...main`] = status;
      const { report, calls } = await judge(scenario);
      expect(report.state).toBe('eligible');
      expect(report.validation[0]).toMatchObject({
        headBranch: 'main',
        headSha: WORKFLOW_SOURCE,
      });
      expect(calls).toContain(
        `${API_ROOT}compare/${WORKFLOW_SOURCE}...main?per_page=1`,
      );
      expect(
        calls.filter((call) => call.includes('/workflows/build.yml/runs?')),
      ).toEqual([
        `${API_ROOT}actions/workflows/build.yml/runs?branch=main&event=workflow_dispatch&per_page=100&page=1`,
        `${API_ROOT}actions/workflows/build.yml/runs?branch=main&event=repository_dispatch&per_page=100&page=1`,
      ]);
    },
  );

  test.each(['cancelled', 'failure', 'skipped', 'timed_out'])(
    'a %s validation run blocks it',
    async (conclusion) => {
      const scenario = passing();
      scenario.candidateRuns = [candidateRun(conclusion)];
      const { report } = await judge(scenario);
      expect(report.state).toBe('blocked');
      expect(report.reasons).toEqual([
        `the candidate validation ${scenario.candidateRuns[0]!.html_url} concluded ${conclusion}`,
      ]);
    },
  );

  test('the newest validation decides, and an earlier failure stays visible', async () => {
    const failed = candidateRun('failure', {
      created_at: '2026-09-29T20:00:00Z',
    });
    const retried = passing();
    const passed = retried.candidateRuns[0]!;
    passed.created_at = '2026-09-29T21:00:00Z';
    retried.candidateRuns.push(failed);
    const after = await judge(retried);
    expect(after.report.state).toBe('eligible');
    expect(after.report.validation.map((entry) => entry.conclusion)).toEqual([
      'success',
      'failure',
    ]);

    // A later failure is not outvoted by an earlier success.
    const regressed = passing();
    regressed.candidateRuns[0]!.created_at = '2026-09-29T20:00:00Z';
    regressed.candidateRuns.push(
      candidateRun('failure', { created_at: '2026-09-29T21:00:00Z' }),
    );
    const again = await judge(regressed);
    expect(again.report.state).toBe('blocked');
    expect(again.report.validation.map((entry) => entry.conclusion)).toEqual([
      'failure',
      'success',
    ]);
  });

  for (const lane of ['candidate', 'checks'] as const) {
    test.each([
      ['failure', 'blocked'],
      ['cancelled', 'blocked'],
      [null, 'pending'],
    ] as const)(
      `${lane}: the latest %s attempt of an older run decides (%s)`,
      async (conclusion, state) => {
        const { scenario, retried } = rerunScenario(lane, conclusion);
        const { report } = await judge(scenario);
        expect(report.state).toBe(state);
        const selected =
          lane === 'candidate'
            ? report.validation[0]
            : report.checks.find(
                (check) => check.workflow === '.github/workflows/checks.yml',
              )?.run;
        expect(selected).toMatchObject({
          url: retried.html_url,
          attempt: 2,
          createdAt: retried.created_at,
          startedAt: retried.run_started_at,
        });
      },
    );

    test(`${lane}: a later successful attempt of an older run recovers a failure`, async () => {
      const { scenario } = rerunScenario(lane, 'success', 'failure');
      expect((await judge(scenario)).report.state).toBe('eligible');
    });

    test(`${lane}: a rerun without an attempt timestamp cannot be ordered as an old success`, async () => {
      const { scenario, retried } = rerunScenario(lane, 'failure');
      delete retried.run_started_at;
      const { report } = await judge(scenario);
      expect(report.state).toBe('blocked');
      expect(report.reasons.join(' ')).toContain('run_started_at');
    });

    test(`${lane}: a newer failed attempt of run 101 cannot hide behind page-one success`, async () => {
      const { scenario, retried } = pagedRerunScenario(lane);
      const { report, calls } = await judge(scenario);
      expect(report.state).toBe('blocked');
      expect(report.reasons.join(' ')).toContain(retried.html_url);
      expect(calls).toContain(`${API_ROOT}${runListPath(lane)}&page=2`);
    });

    test(`${lane}: a newer successful attempt on page two recovers page-one failure`, async () => {
      const { scenario } = pagedRerunScenario(lane, 101, 'success', 'failure');
      const { report, calls } = await judge(scenario);
      expect(report.state).toBe('eligible');
      expect(calls).toContain(`${API_ROOT}${runListPath(lane)}&page=2`);
    });

    test(`${lane}: 999 unique runs complete within ten pages`, async () => {
      const { scenario } = pagedRerunScenario(lane, 999, 'success', 'failure');
      const { report, calls } = await judge(scenario);
      expect(report.state).toBe('eligible');
      expect(
        calls.filter((path) =>
          path.startsWith(`${API_ROOT}${runListPath(lane)}`),
        ),
      ).toHaveLength(10);
    });

    test.each([1000, 1001])(
      `${lane}: refuses %s runs at the API search ceiling`,
      async (count) => {
        const { scenario } = pagedRerunScenario(lane, count);
        const { report, calls } = await judge(scenario);
        expect(report.state).toBe('blocked');
        expect(report.reasons.join(' ')).toContain('1,000-run search ceiling');
        expect(
          calls.filter((path) =>
            path.startsWith(`${API_ROOT}${runListPath(lane)}`),
          ),
        ).toHaveLength(1);
      },
    );

    test.each([
      'repeated',
      'partial',
      'missing',
      'changed total',
      'missing total',
    ])(
      `${lane}: refuses a %s page instead of using incomplete success`,
      async (kind) => {
        const { scenario, rows } = pagedRerunScenario(lane, 201);
        const path = runListPath(lane);
        const first = { total_count: 201, workflow_runs: rows.slice(0, 100) };
        const second = {
          total_count: 201,
          workflow_runs: rows.slice(100, 200),
        };
        scenario.runPageOverrides = {
          [`${path}&page=2`]:
            kind === 'repeated'
              ? first
              : kind === 'partial'
                ? { ...second, workflow_runs: rows.slice(100, 199) }
                : kind === 'missing'
                  ? null
                  : kind === 'changed total'
                    ? { ...second, total_count: 202 }
                    : { workflow_runs: second.workflow_runs },
        };
        const { report } = await judge(scenario);
        expect(report.state).toBe('blocked');
        expect(report.reasons.join(' ')).toContain(
          'incomplete workflow run evidence',
        );
      },
    );
  }

  test('a validation still running leaves it pending', async () => {
    const scenario = passing();
    scenario.candidateRuns = [candidateRun(null)];
    const { report } = await judge(scenario);
    expect(report.state).toBe('pending');
    expect(report.reasons).toEqual([
      `the candidate validation ${scenario.candidateRuns[0]!.html_url} is in_progress`,
    ]);
  });

  test.each([
    ['a skipped', 'skipped'],
    ['a cancelled', 'cancelled'],
    ['no', null],
  ])('%s Candidate gate job blocks a green run', async (_label, verdict) => {
    const scenario = passing();
    const id = scenario.candidateRuns[0]!.id;
    scenario.jobs[id] = scenario.jobs[id]!.filter(
      (job) => job.name !== 'Candidate gate',
    );
    if (verdict)
      scenario.jobs[id]!.push({ name: 'Candidate gate', conclusion: verdict });
    const { report } = await judge(scenario);
    expect(report.state).toBe('blocked');
    expect(report.reasons).toEqual([
      `${scenario.candidateRuns[0]!.html_url} has no successful Candidate gate job`,
    ]);
  });

  test('a missing or expired candidate receipt blocks it', async () => {
    const missing = passing();
    missing.artifacts[missing.candidateRuns[0]!.id] = [
      { id: 8, name: `release-candidate-${ELSEWHERE}`, expired: false },
    ];
    expect((await judge(missing)).report.reasons).toEqual([
      `${missing.candidateRuns[0]!.html_url} kept no candidate receipt`,
    ]);
    const expired = passing();
    expired.artifacts[expired.candidateRuns[0]!.id]![0]!.expired = true;
    const { report } = await judge(expired);
    expect(report.state).toBe('blocked');
    expect(report.receipt).toBeNull();
    expect(report.reasons).toEqual([
      `the candidate receipt of ${expired.candidateRuns[0]!.html_url} expired: validate ${CANDIDATE} again`,
    ]);
  });

  test.each(['cancelled', 'skipped', 'failure'])(
    'the newest %s run of a required workflow blocks it, whatever ran before',
    async (conclusion) => {
      const scenario = passing();
      const newest = run('.github/workflows/checks.yml', conclusion, {
        created_at: '2026-09-29T23:59:00Z',
      });
      scenario.commitRuns.push(newest);
      const { report } = await judge(scenario);
      expect(report.state).toBe('blocked');
      expect(report.reasons).toEqual([
        `.github/workflows/checks.yml ${newest.html_url} concluded ${conclusion}`,
      ]);
    },
  );

  test('a required workflow that never ran for the commit blocks it', async () => {
    const scenario = passing();
    scenario.commitRuns = scenario.commitRuns.filter(
      (entry) => entry.path !== '.github/workflows/e2e.yml',
    );
    const { report } = await judge(scenario);
    expect(report.state).toBe('blocked');
    expect(report.reasons).toEqual([
      `.github/workflows/e2e.yml never ran for ${CANDIDATE}`,
    ]);
  });

  test('a path-filtered workflow blocks it only when it ran and did not pass', async () => {
    const scenario = passing();
    const audit = run('.github/workflows/security.yml', 'failure');
    scenario.commitRuns.push(audit);
    const { report } = await judge(scenario);
    expect(report.state).toBe('blocked');
    expect(report.reasons).toEqual([
      `.github/workflows/security.yml ${audit.html_url} concluded failure`,
    ]);
  });

  test('a required run still going leaves it pending, a failure outranks it', async () => {
    const scenario = passing();
    scenario.commitRuns.push(
      run('.github/workflows/sast.yml', null, {
        created_at: '2026-09-29T23:59:00Z',
      }),
    );
    expect((await judge(scenario)).report.state).toBe('pending');
    scenario.commitRuns.push(
      run('.github/workflows/commitlint.yml', 'failure', {
        created_at: '2026-09-29T23:59:00Z',
      }),
    );
    const { report } = await judge(scenario);
    expect(report.state).toBe('blocked');
    expect(report.reasons).toHaveLength(2);
  });

  test.each([
    ['lightweight', false],
    ['annotated', true],
  ])(
    'a %s version tag already at the candidate is allocated, never tagged again',
    async (_kind, annotated) => {
      const scenario = passing();
      scenario.tags['v0.5.64'] = { sha: CANDIDATE, annotated };
      const { report, calls } = await judge(scenario);
      expect(report.state).toBe('allocated');
      expect(report.tag).toBe(CANDIDATE);
      expect(report.reasons).toEqual([
        `v0.5.64 already points at ${CANDIDATE}: reconcile its Release run, never tag it again`,
      ]);
      expect(calls.some((call) => call.includes('/actions/'))).toBe(false);
    },
  );

  test('a version tag elsewhere is a conflict: a tag is never moved', async () => {
    const scenario = passing();
    scenario.tags['v0.5.64'] = { sha: ELSEWHERE };
    const { report } = await judge(scenario);
    expect(report.state).toBe('conflict');
    expect(report.tag).toBe(ELSEWHERE);
    expect(report.reasons).toEqual([
      `v0.5.64 already points at ${ELSEWHERE}; a tag is never moved or reused`,
    ]);
  });

  test.each([
    ['lightweight', false],
    ['annotated', true],
  ])(
    'an existing %s unprefixed tag reserves the image version before its release completes',
    async (_kind, annotated) => {
      const scenario = passing();
      scenario.tags['0.5.64'] = { sha: ELSEWHERE, annotated };
      const { report, calls } = await judge(scenario);
      expect(report.state).toBe('conflict');
      expect(report.tag).toBe(ELSEWHERE);
      expect(report.tagName).toBe('0.5.64');
      expect(report.reasons).toEqual([
        `0.5.64 already points at ${ELSEWHERE}; a tag is never moved or reused`,
      ]);
      expect(calls.some((call) => call.includes('/actions/'))).toBe(false);
    },
  );

  test.each([
    ['lightweight', false],
    ['annotated', true],
  ])(
    'an existing %s unprefixed tag at the candidate is reconciled under its actual name',
    async (_kind, annotated) => {
      const scenario = passing();
      scenario.tags['0.5.64'] = { sha: CANDIDATE, annotated };
      const { report, calls } = await judge(scenario);
      expect(report.state).toBe('allocated');
      expect(report.tag).toBe(CANDIDATE);
      expect(report.tagName).toBe('0.5.64');
      expect(report.reasons).toEqual([
        `0.5.64 already points at ${CANDIDATE}: reconcile its Release run, never tag it again`,
      ]);
      expect(calls.some((call) => call.includes('/actions/'))).toBe(false);
    },
  );

  test.each([
    [CANDIDATE, ELSEWHERE, '0.5.64'],
    [ELSEWHERE, CANDIDATE, 'v0.5.64'],
  ])(
    'a conflicting pair of version tags never hides behind a same-candidate reservation',
    async (prefixed, unprefixed, conflictingTag) => {
      const scenario = passing();
      scenario.tags['v0.5.64'] = { sha: prefixed, annotated: true };
      scenario.tags['0.5.64'] = { sha: unprefixed, annotated: true };
      const { report } = await judge(scenario);
      expect(report.state).toBe('conflict');
      expect(report.tag).toBe(ELSEWHERE);
      expect(report.tagName).toBe(conflictingTag);
    },
  );

  test('both tag spellings at the same candidate reconcile the requested tag', async () => {
    const scenario = passing();
    scenario.tags['v0.5.64'] = { sha: CANDIDATE };
    scenario.tags['0.5.64'] = { sha: CANDIDATE, annotated: true };
    const { report } = await judge(scenario);
    expect(report.state).toBe('allocated');
    expect(report.tag).toBe(CANDIDATE);
    expect(report.tagName).toBe('v0.5.64');
  });

  test.each([
    ['v0.5.62', 'v0.5.62 is not newer than the latest release v0.5.63'],
    ['v0.4.99', 'v0.4.99 is not newer than the latest release v0.5.63'],
    [
      'v0.5.63-rc.1',
      'v0.5.63-rc.1 is not newer than the latest release v0.5.63',
    ],
  ])(
    'version %s conflicts with the latest release',
    async (version, reason) => {
      const { report } = await judge(passing(), version);
      expect(report.state).toBe('conflict');
      expect(report.reasons).toEqual([reason]);
    },
  );

  test('the same version under the other tag form conflicts too', async () => {
    // release.yml also releases un-prefixed tags (`[0-9]*.*.*`).
    const scenario = passing();
    scenario.latestRelease = '0.5.64';
    scenario.tags = { '0.5.64': { sha: PREVIOUS } };
    const { report } = await judge(scenario);
    expect(report.state).toBe('conflict');
    expect(report.reasons).toEqual([
      `0.5.64 already points at ${PREVIOUS}; a tag is never moved or reused`,
    ]);
  });

  test('a prerelease of the next version is newer than the latest release', async () => {
    expect((await judge(passing(), 'v0.5.64-rc.1')).report.state).toBe(
      'eligible',
    );
  });

  test('a new version cannot republish the latest released source', async () => {
    const scenario = passing();
    scenario.tags['v0.5.63'] = { sha: CANDIDATE };
    scenario.compare[`${CANDIDATE}...${CANDIDATE}`] = 'identical';
    const { report } = await judge(scenario);
    expect(report.state).toBe('conflict');
    expect(report.reasons).toEqual([
      `${CANDIDATE} is already published as v0.5.63; choose a newer candidate`,
    ]);
  });

  test('an existing allocation still reconciles the same released source', async () => {
    const scenario = passing();
    scenario.latestRelease = 'v0.5.64';
    scenario.tags['v0.5.64'] = { sha: CANDIDATE };
    const { report } = await judge(scenario);
    expect(report.state).toBe('allocated');
    expect(report.tagName).toBe('v0.5.64');
  });

  test.each([
    ['diverged', `${CANDIDATE} is not a commit on main (compare: diverged)`],
    ['behind', `${CANDIDATE} is not a commit on main (compare: behind)`],
  ])('a candidate off main (%s) conflicts', async (status, reason) => {
    const scenario = passing();
    scenario.compare[`${CANDIDATE}...main`] = status;
    const { report } = await judge(scenario);
    expect(report.state).toBe('conflict');
    expect(report.reasons).toEqual([reason]);
  });

  test('an unknown commit conflicts, without a misleading ancestry claim', async () => {
    const scenario = passing();
    delete scenario.compare[`${CANDIDATE}...main`];
    const { report } = await judge(scenario);
    expect(report.state).toBe('conflict');
    expect(report.reasons).toEqual([
      `${CANDIDATE} is not a commit of ${REPOSITORY}`,
    ]);
  });

  test('a candidate that does not contain the latest release conflicts', async () => {
    const scenario = passing();
    scenario.compare[`${PREVIOUS}...${CANDIDATE}`] = 'behind';
    const { report } = await judge(scenario);
    expect(report.state).toBe('conflict');
    expect(report.reasons).toEqual([
      `${CANDIDATE} does not contain the latest release v0.5.63`,
    ]);
  });

  test('the first release has nothing to be newer than', async () => {
    const scenario = passing();
    scenario.latestRelease = null;
    scenario.tags = {};
    const { report } = await judge(scenario, 'v0.1.0');
    expect(report.state).toBe('eligible');
    expect(report.latestRelease).toBeNull();
  });

  test.each([
    [{ sha: 'main' }, '--sha must be a full 40-character commit SHA'],
    [
      { sha: CANDIDATE.slice(0, 7) },
      '--sha must be a full 40-character commit SHA',
    ],
    [
      { sha: CANDIDATE.toUpperCase() },
      '--sha must be a full 40-character commit SHA',
    ],
    [{ sha: `${CANDIDATE}\n` }, '--sha must be a full 40-character commit SHA'],
    [{ version: '0.5.64' }, '--version must be an exact version like v1.2.3'],
    [{ version: 'v0.5' }, '--version must be an exact version like v1.2.3'],
    [
      { version: 'v0.5.64; true' },
      '--version must be an exact version like v1.2.3',
    ],
    [{ repository: 'synthetic' }, '--repo must be owner/name'],
    [{ repository: 'a/b/c' }, '--repo must be owner/name'],
  ])('refuses %j before reading anything', async (override, message) => {
    const { api, calls } = fakeApi(passing());
    const error = await gate({
      sha: CANDIDATE,
      version: 'v0.5.64',
      repository: REPOSITORY,
      api,
      ...override,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).message).toBe(message);
    expect(calls).toEqual([]);
  });
});

/** The script as the release lane runs it, against a `gh` stand-in that
 * answers each `gh api` path from a fixture file and 404s the rest. */
describe('release candidate gate command', () => {
  const script = fileURLToPath(
    new URL('./release-candidate-gate.ts', import.meta.url),
  );
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0))
      await rm(root, { recursive: true, force: true });
  });

  async function command(args: string[], scenario?: Scenario) {
    const root = await mkdtemp(join(tmpdir(), 'tale-release-gate-'));
    roots.push(root);
    const bin = join(root, 'bin');
    const fixtures = join(root, 'fixtures');
    await mkdir(bin);
    await mkdir(fixtures);
    if (scenario) {
      // Answer every path the in-process fake would, byte for byte.
      const { api } = fakeApi(scenario);
      const paths = [
        `git/ref/tags/v0.5.64`,
        `git/ref/tags/0.5.64`,
        `compare/${CANDIDATE}...main?per_page=1`,
        `releases/latest`,
        `git/ref/tags/v0.5.63`,
        `compare/${PREVIOUS}...${CANDIDATE}?per_page=1`,
        `compare/${WORKFLOW_SOURCE}...main?per_page=1`,
        `actions/workflows/build.yml/runs?branch=main&event=workflow_dispatch&per_page=100`,
        `actions/workflows/build.yml/runs?branch=main&event=repository_dispatch&per_page=100`,
        ...['workflow_dispatch', 'repository_dispatch'].flatMap((event) =>
          Array.from(
            {
              length: Math.max(
                1,
                Math.ceil(
                  scenario.candidateRuns.filter(
                    (entry) => entry.event === event,
                  ).length / 100,
                ),
              ),
            },
            (_unused, page) =>
              `actions/workflows/build.yml/runs?branch=main&event=${event}&per_page=100&page=${page + 1}`,
          ),
        ),
        ...REQUIRED_WORKFLOWS.map(
          (workflow) =>
            `actions/workflows/${workflow.split('/').at(-1)}/runs?branch=main&event=repository_dispatch&per_page=100&page=1`,
        ),
        ...scenario.candidateRuns.flatMap((entry) => [
          `actions/runs/${entry.id}`,
          `actions/runs/${entry.id}/attempts/${entry.run_attempt}/jobs?per_page=100`,
          `actions/runs/${entry.id}/artifacts?per_page=100`,
        ]),
        ...Object.values(scenario.artifacts).flatMap((entries) =>
          entries.map((entry) => `actions/artifacts/${entry.id}/zip`),
        ),
        `actions/runs?head_sha=${CANDIDATE}&per_page=100`,
        ...Array.from(
          { length: Math.max(1, Math.ceil(scenario.commitRuns.length / 100)) },
          (_unused, page) =>
            `actions/runs?head_sha=${CANDIDATE}&per_page=100&page=${page + 1}`,
        ),
      ];
      for (const path of paths) {
        const answer = await api(API_ROOT + path);
        if (answer === null) continue;
        const destination = join(fixtures, encodeURIComponent(API_ROOT + path));
        if (path.endsWith('/zip')) {
          const child = Bun.spawn(
            [
              'python3',
              '-c',
              "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1], 'w'); z.writestr('release-candidate.json', sys.argv[2]); z.close()",
              destination,
              JSON.stringify(answer),
            ],
            { stdout: 'pipe', stderr: 'pipe' },
          );
          expect(await child.exited).toBe(0);
        } else await writeFile(destination, JSON.stringify(answer));
      }
    }
    await writeFile(
      join(bin, 'gh'),
      `#!/bin/sh
[ "$1" = api ] || { echo "gh: unexpected $*" >&2; exit 2; }
file="$TEST_FIXTURES/$(printf '%s' "$2" | jq -sRr @uri)"
if [ -f "$file" ]; then cat "$file"; exit 0; fi
echo '{"message":"Not Found"}'
echo 'gh: Not Found (HTTP 404)' >&2
exit 1
`,
      { mode: 0o755 },
    );
    const child = Bun.spawn(['bun', script, ...args], {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: process.env.HOME ?? root,
        TEST_FIXTURES: fixtures,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  }

  const args = [
    '--sha',
    CANDIDATE,
    '--version',
    'v0.5.64',
    '--repo',
    REPOSITORY,
  ];

  test.skipIf(process.platform === 'win32')(
    'exits 0 with the report only when the candidate is eligible',
    async () => {
      const eligible = await command(args, passing());
      expect(eligible.code, eligible.stderr).toBe(0);
      expect(JSON.parse(eligible.stdout).state).toBe('eligible');

      const unvalidated = passing();
      unvalidated.candidateRuns = [];
      const blocked = await command(args, unvalidated);
      expect(blocked.code).toBe(1);
      expect(JSON.parse(blocked.stdout)).toMatchObject({
        state: 'blocked',
        validation: [],
      });
    },
    30_000,
  );

  test.skipIf(process.platform === 'win32')(
    'the native CLI validates all seven real ZIP receipts for C from main H',
    async () => {
      const result = await command(args, dispatchedSources());
      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        state: 'eligible',
        checks: expect.arrayContaining([
          {
            workflow: '.github/workflows/e2e.yml',
            run: expect.objectContaining({ headSha: WORKFLOW_SOURCE }),
            receipt: expect.any(Object),
          },
        ]),
      });
    },
    30_000,
  );

  test.skipIf(process.platform === 'win32')(
    'exits 1 when an unfinished unprefixed release already reserved the image version',
    async () => {
      const scenario = passing();
      scenario.tags['0.5.64'] = { sha: ELSEWHERE };
      const result = await command(args, scenario);
      expect(result.code, result.stderr).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        state: 'conflict',
        tag: ELSEWHERE,
        tagName: '0.5.64',
      });
    },
    30_000,
  );

  for (const lane of ['candidate', 'checks'] as const) {
    test.skipIf(process.platform === 'win32')(
      `${lane}: exits 1 when a later attempt of an older run failed`,
      async () => {
        const { scenario } = rerunScenario(lane, 'failure');
        const result = await command(args, scenario);
        expect(result.code, result.stderr).toBe(1);
        expect(JSON.parse(result.stdout).state).toBe('blocked');
      },
      30_000,
    );

    test.skipIf(process.platform === 'win32')(
      `${lane}: CLI blocks a page-two failure and accepts its later recovery`,
      async () => {
        const failed = await command(args, pagedRerunScenario(lane).scenario);
        expect(failed.code, failed.stderr).toBe(1);
        expect(JSON.parse(failed.stdout).state).toBe('blocked');
        const passed = await command(
          args,
          pagedRerunScenario(lane, 101, 'success', 'failure').scenario,
        );
        expect(passed.code, passed.stderr).toBe(0);
        expect(JSON.parse(passed.stdout).state).toBe('eligible');
      },
      30_000,
    );
  }

  test.skipIf(process.platform === 'win32')(
    'exits 2 on arguments it cannot use, before calling gh',
    async () => {
      for (const bad of [
        ['--sha', 'main', '--version', 'v0.5.64'],
        ['--sha', CANDIDATE],
        ['--sha', CANDIDATE, '--version', 'v0.5.64', '--force'],
      ]) {
        const result = await command(bad);
        expect(result.code).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain(
          'usage: bun tools/cli/scripts/release-candidate-gate.ts',
        );
      }
    },
    30_000,
  );
});
