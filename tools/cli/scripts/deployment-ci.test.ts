import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { parse } from 'yaml';

import { THIRD_PARTY_IMAGES } from '../src/lib/compose/types';

type Step = {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  'working-directory'?: string;
  'continue-on-error'?: boolean;
};
const repository = fileURLToPath(new URL('../../..', import.meta.url));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function execute(
  script: string | undefined,
  environment: Record<string, string>,
  commands: Record<string, string> = {},
) {
  if (!script) throw new Error('Deployment CI script is missing');
  const root = await mkdtemp(join(tmpdir(), 'tale-deployment-ci-'));
  roots.push(root);
  const output = join(root, 'output');
  await writeFile(output, '');
  for (const [name, body] of Object.entries(commands)) {
    await writeFile(join(root, name), body, { mode: 0o755 });
  }
  // macOS still ships Bash 3.2. Its errexit behavior differs for a bare
  // failed [[ condition ]], so exercise that supported shell explicitly.
  const shell = process.platform === 'darwin' ? '/bin/bash' : 'bash';
  const child = Bun.spawn([shell, '-c', script], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      GITHUB_OUTPUT: output,
      GITHUB_ENV: join(root, 'environment'),
      PROOF_DIR: root,
      RUNNER_TEMP: root,
      ...environment,
      ...(Object.keys(commands).length > 0
        ? { PATH: `${root}:${environment.PATH ?? process.env.PATH}` }
        : {}),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { root, code, stdout, stderr, output: await readFile(output, 'utf8') };
}

test.skipIf(process.platform === 'win32')(
  'actual image publication script uses complete source identity for main and PR tags',
  async () => {
    const workflow = parse(
      await readFile(join(repository, '.github/workflows/build.yml'), 'utf8'),
    ) as { jobs: { changes: { steps: Step[] } } };
    const script = workflow.jobs.changes.steps.find(
      (step) => step.id === 'tag',
    )?.run;
    const revision = '1234567890abcdef1234567890abcdef12345678';
    for (const pr of ['', '913']) {
      const result = await execute(script, {
        GITHUB_SHA: revision,
        PR_NUMBER: pr,
      });
      expect(result.code).toBe(0);
      expect(result.output).toBe(
        `value=${pr ? `pr-${pr}-` : ''}sha-${revision}\n`,
      );
    }
    for (const sha of ['main', revision.slice(0, 7), `${revision}\n`, '']) {
      const result = await execute(script, { GITHUB_SHA: sha, PR_NUMBER: '' });
      expect(result.code).not.toBe(0);
      expect(result.output).toBe('');
    }
    for (const pr of ['913\n', 'branch', '913; exit 0']) {
      const result = await execute(script, {
        GITHUB_SHA: revision,
        PR_NUMBER: pr,
      });
      expect(result.code).not.toBe(0);
      expect(result.output).toBe('');
    }
  },
);

test('PR-image cleanup covers exactly the images the build job publishes', async () => {
  // Only the build job pushes `pr-N-sha-` tags. A service it no longer builds
  // has no package left to clean (convex and controller, 2026-09); one it
  // builds but the cleanup skips leaks a tag on every push.
  const services = async (name: string, job: string) => {
    const workflow = parse(
      await readFile(join(repository, '.github/workflows', name), 'utf8'),
    ) as {
      jobs: Record<
        string,
        { strategy?: { matrix?: { service?: string[] } } } | undefined
      >;
    };
    return workflow.jobs[job]?.strategy?.matrix?.service?.toSorted() ?? [];
  };
  const built = await services('build.yml', 'build');
  expect(built).toContain('platform');
  expect(await services('cleanup-pr-images.yml', 'delete')).toEqual(built);
});

/** A release candidate (#3951): one full SHA on main, validated by the same
 * Build jobs as every push, in a run no main merge can cancel. These run the
 * workflow's own scripts; GitHub's expressions are held to their text. */
describe('release candidate validation', () => {
  type Job = {
    name?: string;
    needs?: string | string[];
    if?: string;
    permissions?: Record<string, string>;
    uses?: string;
    with?: Record<string, unknown>;
    strategy?: { matrix?: { service?: string[] } };
    steps: Step[];
  };
  type Workflow = {
    'run-name'?: string;
    on: {
      workflow_dispatch?: {
        inputs?: Record<string, { required?: boolean; type?: string }>;
      };
      repository_dispatch?: { types?: string[] };
      push?: { branches?: string[] };
      pull_request?: { branches?: string[] };
    };
    concurrency: { group: string; 'cancel-in-progress': string | boolean };
    jobs: Record<string, Job>;
  };
  const CANDIDATE = 'c'.repeat(40);
  const HEAD = 'd'.repeat(40);
  const DISPATCHES = ['workflow_dispatch', 'repository_dispatch'];
  const workflow = async () =>
    parse(
      await readFile(join(repository, '.github/workflows/build.yml'), 'utf8'),
    ) as Workflow;

  test.each([
    ['push', 'refs/heads/main', false],
    ['push', 'refs/heads/other', true],
    ['pull_request', 'refs/pull/1/merge', true],
    ['merge_group', 'refs/heads/gh-readonly-queue/main/pr-1', true],
    ['workflow_dispatch', 'refs/heads/main', false],
    ['repository_dispatch', 'refs/heads/main', false],
  ] as const)(
    '%s on %s cancels an admitted Build only when supersedable',
    async (eventName, ref, expected) => {
      const policy = (await workflow()).concurrency['cancel-in-progress'];
      expect(typeof policy).toBe('string');
      // This source-owned expression uses only string comparisons and boolean
      // operators, with the same semantics for these lowercase event/ref values
      // in JavaScript and Actions. Evaluate the parsed workflow's actual policy,
      // not a second implementation of the intended event mapping.
      const expression = String(policy).match(/^\$\{\{ (.+) \}\}$/)?.[1];
      expect(expression).toBeDefined();
      const actual: unknown = runInNewContext(
        expression!,
        { github: { event_name: eventName, ref } },
        { timeout: 100 },
      );
      expect(actual).toBe(expected);
    },
  );
  const step = (job: Job, name: string) => {
    const found = (job.steps ?? []).find((entry) => entry.name === name);
    if (!found) throw new Error(`build.yml step "${name}" is missing`);
    return found;
  };
  const sourceStep = async () => {
    const shared = parse(
      await readFile(
        join(repository, '.github/workflows/release-candidate-source.yml'),
        'utf8',
      ),
    ) as Workflow;
    return step(shared.jobs.source!, 'Resolve source');
  };
  /** The workflow context a script reads through `${{ … }}` text. */
  const expand = (script: string | undefined) =>
    script
      ?.replaceAll('${{ env.REGISTRY }}', 'ghcr.io')
      .replaceAll('${{ github.repository }}', 'tale-project/tale');
  const outputs = (text: string) =>
    Object.fromEntries(
      text
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => [
          line.slice(0, line.indexOf('=')),
          line.slice(line.indexOf('=') + 1),
        ]),
    );
  async function tempDirectory(prefix: string) {
    const root = await mkdtemp(join(tmpdir(), prefix));
    roots.push(root);
    return root;
  }
  /** Stand-ins that log each call. `docker image inspect` answers the
   * revision label of the image, `gh api … compare` the compare status. */
  async function standIns() {
    const bin = await tempDirectory('tale-candidate-bin-');
    const log = join(bin, 'calls');
    await writeFile(log, '');
    await writeFile(
      join(bin, 'docker'),
      `#!/bin/sh
printf 'docker %s\\n' "$*" >> "$TEST_COMMAND_LOG"
if [ "$1" = pull ] && [ "$TEST_TRACK_PULLS" = true ]; then
  printf 'pull-start %s\\n' "$2" >> "$TEST_COMMAND_LOG"
  service="\${2##*/}"
  service="\${service#tale-}"
  service="\${service%%@*}"
  # The prioritized first batch joins at a barrier: all three starts must
  # be logged before any finish, so overlap never depends on host scheduling.
  case "$service" in
    sandbox-runtime|platform|db)
      touch "$TEST_COMMAND_LOG.$service"
      attempts=0
      while [ ! -f "$TEST_COMMAND_LOG.sandbox-runtime" ] ||
            [ ! -f "$TEST_COMMAND_LOG.platform" ] ||
            [ ! -f "$TEST_COMMAND_LOG.db" ]; do
        attempts=$((attempts + 1))
        if [ "$attempts" -gt 1000 ]; then exit 1; fi
        sleep 0.01
      done
      ;;
  esac
  printf 'pull-end %s\\n' "$2" >> "$TEST_COMMAND_LOG"
fi
if [ "$1" = "$TEST_FAIL_COMMAND" ]; then
  case "$*" in *tale-"$TEST_FAIL_SERVICE"@*) exit 37 ;; esac
fi
if [ "$1 $2" = 'image inspect' ]; then
  case "$5" in
    *tale-"$TEST_FOREIGN_SERVICE"@*) printf '%s\\n' "$TEST_FOREIGN_REVISION" ;;
    *) printf '%s\\n' "$TEST_REVISION" ;;
  esac
fi
`,
      { mode: 0o755 },
    );
    await writeFile(
      join(bin, 'gh'),
      `#!/bin/sh
printf 'gh %s\\n' "$*" >> "$TEST_COMMAND_LOG"
if [ -n "$TEST_GH_FAILS" ]; then echo 'gh: Not Found (HTTP 404)' >&2; exit 1; fi
printf '%s\\n' "$TEST_COMPARE_STATUS"
`,
      { mode: 0o755 },
    );
    return {
      path: `${bin}:${process.env.PATH}`,
      log,
      calls: async () =>
        (await readFile(log, 'utf8')).split('\n').filter(Boolean),
    };
  }
  const BUILT = [
    'db',
    'platform',
    'proxy',
    'sandbox-llm-gateway',
    'sandbox',
    'sandbox-egress',
    'sandbox-buildkitd',
    'sandbox-runtime',
  ];
  const digest = (service: string) =>
    `sha256:${Array.from(service)
      .map((char) => char.charCodeAt(0).toString(16))
      .join('')
      .padEnd(64, '0')
      .slice(0, 64)}`;
  /** The receipts the build job's legs upload, as the download merges them. */
  async function receipts(
    revision: string,
    tag: string,
    change: (service: string) => Record<string, string> | null = () => ({}),
  ) {
    const directory = await tempDirectory('tale-image-receipts-');
    for (const service of BUILT) {
      const patch = change(service);
      if (patch === null) continue;
      await writeFile(
        join(directory, `${service}.json`),
        JSON.stringify({
          service,
          image: `ghcr.io/tale-project/tale/tale-${service}`,
          tag,
          digest: digest(service),
          revision,
          ...patch,
        }),
      );
    }
    return directory;
  }

  test('a dispatch names one SHA, and main merges never share its group', async () => {
    const build = await workflow();
    expect(build.on.workflow_dispatch?.inputs).toEqual({
      candidate_sha: expect.objectContaining({
        required: true,
        type: 'string',
      }),
    });
    expect(build.on.repository_dispatch?.types).toEqual(['release-candidate']);
    expect(build.on.push?.branches).toEqual(['main']);
    expect(build.on.pull_request?.branches).toEqual(['main']);
    const dispatched =
      "(github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch')";
    const candidate =
      'inputs.candidate_sha || github.event.client_payload.candidate_sha';
    // Ordinary events keep `Build-<ref>`; main pushes finish the admitted run
    // while superseded pending runs coalesce. Either dispatch of one SHA shares
    // `Build-candidate-<sha>`,
    // which only another dispatch of that SHA can enter, and cancels nothing.
    expect(build.concurrency).toEqual({
      group: `\${{ github.workflow }}-\${{ ${dispatched} && format('candidate-{0}', ${candidate}) || github.ref }}`,
      'cancel-in-progress':
        "${{ github.event_name != 'workflow_dispatch' && github.event_name != 'repository_dispatch' && !(github.event_name == 'push' && github.ref == 'refs/heads/main') }}",
    });
    // The title the release gate finds the run by; empty (GitHub's default
    // title) for every other event.
    expect(build['run-name']).toBe(
      `\${{ ${dispatched} && format('Release candidate {0}', ${candidate}) || '' }}`,
    );
  });

  test.skipIf(process.platform === 'win32')(
    'a push or pull request builds its own commit and asks nothing of main',
    async () => {
      const script = await sourceStep();
      for (const event of ['push', 'pull_request', 'merge_group']) {
        const tools = await standIns();
        const result = await execute(script.run, {
          PATH: tools.path,
          TEST_COMMAND_LOG: tools.log,
          IS_CANDIDATE: 'false',
          EVENT_NAME: event,
          CANDIDATE_SHA: '',
          GITHUB_SHA: HEAD,
          REPOSITORY: 'tale-project/tale',
        });
        expect(result.code, result.stdout + result.stderr).toBe(0);
        expect(result.output).toBe(`sha=${HEAD}\ncandidate_sha=\n`);
        expect(await tools.calls()).toEqual([]);
      }
    },
  );

  test.skipIf(process.platform === 'win32')(
    'a dispatched candidate must be a full SHA that main contains',
    async () => {
      const script = await sourceStep();
      expect(script.env?.CANDIDATE_SHA).toBe('${{ inputs.candidate_sha }}');
      expect(
        (await workflow()).jobs['candidate-source']?.with?.candidate_sha,
      ).toBe(
        '${{ inputs.candidate_sha || github.event.client_payload.candidate_sha }}',
      );
      const run = async (
        event: string,
        candidate: string,
        reply: { status?: string; fails?: boolean } = {},
      ) => {
        const tools = await standIns();
        const result = await execute(script.run, {
          PATH: tools.path,
          TEST_COMMAND_LOG: tools.log,
          TEST_COMPARE_STATUS: reply.status ?? 'ahead',
          TEST_GH_FAILS: reply.fails ? '1' : '',
          IS_CANDIDATE: 'true',
          EVENT_NAME: event,
          CANDIDATE_SHA: candidate,
          GITHUB_SHA: HEAD,
          REPOSITORY: 'tale-project/tale',
        });
        return { ...result, calls: await tools.calls() };
      };
      for (const event of DISPATCHES) {
        for (const status of ['ahead', 'identical']) {
          const result = await run(event, CANDIDATE, { status });
          expect(result.code, result.stdout + result.stderr).toBe(0);
          // The candidate, never the dispatched ref's head.
          expect(result.output).toBe(
            `sha=${CANDIDATE}\ncandidate_sha=${CANDIDATE}\n`,
          );
          expect(result.calls).toEqual([
            `gh api repos/tale-project/tale/compare/${CANDIDATE}...main?per_page=1 --jq .status`,
          ]);
        }
        for (const candidate of [
          '',
          'main',
          'v0.5.64',
          CANDIDATE.slice(0, 7),
          CANDIDATE.toUpperCase(),
          `${CANDIDATE}\n`,
          `${CANDIDATE} `,
        ]) {
          const result = await run(event, candidate);
          expect(result.code).not.toBe(0);
          expect(result.stdout).toContain(
            '::error::A release candidate must be a full 40-character commit SHA',
          );
          expect(result.output).toBe('');
          expect(result.calls).toEqual([]);
        }
        for (const status of ['behind', 'diverged', '']) {
          const result = await run(event, CANDIDATE, { status });
          expect(result.code).not.toBe(0);
          expect(result.stdout).toContain(
            `::error::Release candidate ${CANDIDATE} is not a commit on main`,
          );
          expect(result.output).toBe('');
        }
        const unknown = await run(event, CANDIDATE, { fails: true });
        expect(unknown.code).not.toBe(0);
        expect(unknown.stdout).toContain(
          `::error::Could not compare release candidate ${CANDIDATE} with main`,
        );
        expect(unknown.output).toBe('');
      }
    },
  );

  test.skipIf(process.platform === 'win32')(
    'a candidate runs every check its last commit did not touch, and no advisory scan',
    async () => {
      const changes = (await workflow()).jobs.changes!;
      const filters = Object.keys(
        parse(
          await readFile(
            join(
              repository,
              String(step(changes, 'Filter paths').with?.filters),
            ),
            'utf8',
          ),
        ) as Record<string, unknown>,
      )
        .filter((name) => name.startsWith('build_'))
        .map((name) => name.slice(6));
      expect(step(changes, 'Filter paths').if).toBe(
        "needs.candidate-source.outputs.candidate_sha == '' && github.event_name != 'pull_request' && github.event_name != 'merge_group' && needs.pr-scope.outputs.full != 'true'",
      );
      const matrix = step(changes, 'Compute service matrix').run;
      const candidate = outputs(
        (
          await execute(matrix, {
            CANDIDATE_SHA: CANDIDATE,
            EVENT_NAME: 'repository_dispatch',
            FULL_SCOPE: '',
            CHANGES: '',
            CI_TESTS: '',
            STORYBOOK: '',
            IMAGE_INPUTS: '',
          })
        ).output,
      );
      expect(candidate.ci_tests).toBe('true');
      expect(candidate.storybook).toBe('true');
      expect(candidate.scannable).toBe('[]');
      // Every filter the paths-filter step defines, pseudo-filters included:
      // a service filter added there without the candidate list fails here.
      expect(
        [
          ...(JSON.parse(candidate.list!) as string[]),
          'ci_tests',
          'storybook',
          'image_inputs',
        ].toSorted(),
      ).toEqual(filters.toSorted());
      expect(JSON.parse(candidate.list!)).toEqual(
        expect.arrayContaining([
          ...BUILT,
          'web',
          'docs',
          'ui-docs',
          'ai-gateway',
        ]),
      );

      // Any other run keeps what the filter found.
      const pushed = await execute(matrix, {
        CANDIDATE_SHA: '',
        EVENT_NAME: 'push',
        FULL_SCOPE: '',
        CHANGES:
          '["build_platform","build_web","build_ci_tests","all","build"]',
        CI_TESTS: 'true',
        STORYBOOK: 'false',
        IMAGE_INPUTS: '',
      });
      expect(pushed.code, pushed.stdout + pushed.stderr).toBe(0);
      expect(outputs(pushed.output)).toEqual({
        list: '["platform","web"]',
        scannable: '["platform"]',
        ci_tests: 'true',
        stack: 'true',
        storybook: 'false',
      });
      for (const [event, full] of [
        ['merge_group', ''],
        ['pull_request', 'true'],
      ]) {
        const complete = await execute(matrix, {
          CANDIDATE_SHA: '',
          EVENT_NAME: event!,
          FULL_SCOPE: full!,
          CHANGES: '',
          CI_TESTS: '',
          STORYBOOK: '',
        });
        expect(complete.code, complete.stderr).toBe(0);
        const all = outputs(complete.output);
        expect(all.list).toBe(candidate.list);
        expect(all.ci_tests).toBe('true');
        expect(all.storybook).toBe('true');
        expect(JSON.parse(all.scannable!)).toEqual(
          expect.arrayContaining(BUILT),
        );
      }
      // Even if the live PR has moved while this job waited, consume the
      // one frozen scope decision; do not run a second PR files query.
      const frozen = await execute(matrix, {
        CANDIDATE_SHA: '',
        EVENT_NAME: 'pull_request',
        FULL_SCOPE: 'false',
        PR_CHANGES: '["platform","ci_tests"]',
        PR_CI_TESTS: 'true',
        PR_STORYBOOK: 'false',
        CHANGES: '["build_docs"]',
        CI_TESTS: 'false',
        STORYBOOK: 'false',
      });
      expect(frozen.code, frozen.stderr).toBe(0);
      expect(outputs(frozen.output).list).toBe('["platform"]');
      expect(outputs(frozen.output).ci_tests).toBe('true');
    },
  );

  test('a fork relies on its local smoke and image-validation jobs, never an isolated build matrix', async () => {
    const build = await workflow();
    expect(build.jobs.build?.if).toContain(
      'github.event.pull_request.head.repo.fork != true',
    );
    for (const id of ['smoke-test-fork', 'image-validate-fork']) {
      expect(build.jobs[id]?.needs).toBe('changes');
      expect(build.jobs[id]?.if).toContain(
        'github.event.pull_request.head.repo.fork == true',
      );
    }
    const fork = build.jobs['image-validate-fork']!;
    const catalog = step(fork, 'Validate builtin configs');
    expect(catalog.run).toBe(
      'bun run --filter @tale/platform configs:validate',
    );
    expect(fork.steps.indexOf(catalog)).toBeGreaterThan(
      fork.steps.indexOf(step(fork, 'Setup toolchain')),
    );
    expect(fork.steps.indexOf(catalog)).toBeLessThan(
      fork.steps.indexOf(step(fork, 'Run image validation (local build)')),
    );
    const validate = step(build.jobs.build!, 'Setup toolchain');
    expect(validate.with?.['turbo-cache']).toBe('false');
  });

  test.skipIf(process.platform === 'win32')(
    'stack gates omit static-only work and duplicate fork publication',
    async () => {
      const build = await workflow();
      for (const stack of [true, false]) {
        for (const fork of [true, false]) {
          for (const id of [
            'build',
            'smoke-test',
            'image-validate',
            'smoke-test-fork',
            'image-validate-fork',
          ]) {
            const runs = runInNewContext(
              build.jobs[id]!.if!,
              {
                cancelled: () => false,
                needs: {
                  changes: {
                    result: 'success',
                    outputs: {
                      services: '["docs"]',
                      ci_tests: 'false',
                      stack: String(stack),
                    },
                  },
                  build: { result: 'success' },
                },
                github: {
                  event: {
                    pull_request: { draft: false, head: { repo: { fork } } },
                  },
                },
              },
              { timeout: 100 },
            );
            expect(runs, `${id}, stack=${stack}, fork=${fork}`).toBe(
              stack && (id.endsWith('-fork') ? fork : !fork),
            );
          }
        }
      }
    },
  );

  test('hosted builders publish shared cache only on main and skip teardown', async () => {
    const build = await workflow();
    const job = build.jobs.build!;
    for (const entry of Object.values(build.jobs)) {
      for (const builder of entry.steps ?? []) {
        if (builder.uses?.startsWith('docker/setup-buildx-action@')) {
          expect(builder.with?.cleanup).toBe(false);
        }
      }
    }
    expect(step(job, 'Build and push').with?.['cache-from']).toBe(
      'type=gha,scope=${{ matrix.service }}',
    );
    const cache = String(step(job, 'Build and push').with?.['cache-to']);
    for (const [event, ref, expected] of [
      [
        'push',
        'refs/heads/main',
        'type=gha,scope=platform,mode=max,ghtoken=test-github-token,repository=tale-project/tale',
      ],
      ['pull_request', 'refs/pull/1/merge', ''],
      ['merge_group', 'refs/heads/gh-readonly-queue/main/pr-1', ''],
      ['workflow_dispatch', 'refs/heads/main', ''],
      ['repository_dispatch', 'refs/heads/main', ''],
    ]) {
      expect(
        runInNewContext(
          cache.slice(3, -2),
          {
            github: { event_name: event, ref, repository: 'tale-project/tale' },
            matrix: { service: 'platform' },
            secrets: { GITHUB_TOKEN: 'test-github-token' },
            format: (template: string, ...values: string[]) =>
              values.reduce(
                (result, value, index) =>
                  result.replaceAll(`{${index}}`, value),
                template,
              ),
          },
          { timeout: 100 },
        ),
      ).toBe(expected);
    }
  });

  test('fork validation still builds every published compose and spawner image', async () => {
    const compose = parse(
      await readFile(join(repository, 'compose.yml'), 'utf8'),
    ) as {
      services: Record<string, { build?: { dockerfile: string } }>;
    };
    const imageTest = await readFile(
      join(
        repository,
        'services/platform/tests/integration/container-image-test.ts',
      ),
      'utf8',
    );
    const spawnerImages = imageTest
      .match(/const SPAWNER_IMAGES = new Set\(\[([^\]]+)\]/)?.[1]
      .match(/'([^']+)'/g)
      ?.map((value) => value.slice(1, -1));
    expect(spawnerImages).toBeDefined();
    const builds = new Set(
      Object.values(compose.services).flatMap((service) =>
        service.build ? [service.build.dockerfile] : [],
      ),
    );
    for (const service of BUILT) {
      expect(
        builds.has(`services/${service}/Dockerfile`) ||
          spawnerImages!.includes(service),
        service,
      ).toBe(true);
    }
    expect(imageTest).toContain("compose.run(['build', '--parallel'])");
    expect(imageTest).toContain('for (const svc of SPAWNER_IMAGES)');
    const forkJob = (await workflow()).jobs['image-validate-fork']!;
    const configGuard = step(forkJob, 'Validate builtin configs');
    expect(
      forkJob.steps.filter(
        (entry) => entry.name === 'Validate builtin configs',
      ),
    ).toHaveLength(1);
    expect(configGuard.run).toBe(
      'bun run --filter @tale/platform configs:validate',
    );
    expect(
      forkJob.steps.indexOf(step(forkJob, 'Setup toolchain')),
    ).toBeLessThan(forkJob.steps.indexOf(configGuard));
    expect(
      step(
        (await workflow()).jobs['image-validate-fork']!,
        'Run image validation (local build)',
      ).env?.SKIP_BUILD,
    ).toBeUndefined();
  });

  test.skipIf(process.platform === 'win32')(
    'candidate images carry their own SHA tag',
    async () => {
      const script = step(
        (await workflow()).jobs.changes!,
        'Compute image tag',
      );
      expect(script.env?.CANDIDATE_SHA).toBe(
        '${{ needs.candidate-source.outputs.candidate_sha }}',
      );
      for (const pr of ['', '913']) {
        const result = await execute(script.run, {
          GITHUB_SHA: HEAD,
          PR_NUMBER: pr,
          CANDIDATE_SHA: CANDIDATE,
        });
        expect(result.code, result.stdout + result.stderr).toBe(0);
        expect(result.output).toBe(`value=candidate-sha-${CANDIDATE}\n`);
      }
      for (const candidate of [
        'main',
        CANDIDATE.slice(0, 7),
        `${CANDIDATE}\n`,
      ]) {
        const result = await execute(script.run, {
          GITHUB_SHA: HEAD,
          PR_NUMBER: '',
          CANDIDATE_SHA: candidate,
        });
        expect(result.code).not.toBe(0);
        expect(result.output).toBe('');
      }
    },
  );

  test('every job checks out the candidate, or its event default outside one', async () => {
    const build = await workflow();
    const changes = build.jobs.changes!;
    const checkouts = Object.entries(build.jobs).flatMap(([id, job]) =>
      (job.steps ?? [])
        .filter((entry) => entry.uses?.startsWith('actions/checkout@'))
        .map((entry) => ({ id, job, entry })),
    );
    expect(checkouts.length).toBeGreaterThan(10);
    for (const { id, job, entry } of checkouts) {
      if (entry.name === 'Checkout CI image pull helper') {
        expect(['smoke-test', 'image-validate']).toContain(id);
        expect(entry.if).toBe("needs.changes.outputs.candidate_sha != ''");
        expect(entry.with).toEqual({
          ref: '${{ github.workflow_sha }}',
          path: '.ci-workflow',
          'persist-credentials': false,
          'sparse-checkout': '.github/scripts/pull-ci-images.sh',
          'sparse-checkout-cone-mode': false,
        });
        continue;
      }
      if (['pr-scope', 'ci-ready'].includes(id)) {
        expect(job.if).toContain("github.event_name == 'pull_request'");
        expect(entry.with?.ref).toBeUndefined();
        continue;
      }
      if (id === 'changes') {
        expect(entry.with?.ref).toBe(
          '${{ needs.candidate-source.outputs.candidate_sha }}',
        );
        expect(changes.needs).toEqual(['candidate-source', 'pr-scope']);
        expect(build.jobs['candidate-source']?.uses).toBe(
          './.github/workflows/release-candidate-source.yml',
        );
        continue;
      }
      expect({ id, ref: entry.with?.ref }).toEqual({
        id,
        ref: '${{ needs.changes.outputs.candidate_sha }}',
      });
      expect([job.needs ?? []].flat()).toContain('changes');
    }
  });

  test.skipIf(process.platform === 'win32')(
    'the build labels each image with the checked-out source, or fails',
    async () => {
      const job = (await workflow()).jobs.build!;
      const meta = step(job, 'Resolve build metadata');
      expect(meta.env?.SOURCE_SHA).toBe(
        '${{ needs.changes.outputs.source_sha }}',
      );
      const checkout = await tempDirectory('tale-candidate-checkout-');
      const git = (...args: string[]) =>
        Bun.spawnSync(['git', ...args], {
          cwd: checkout,
          env: {
            PATH: process.env.PATH,
            GIT_AUTHOR_NAME: 'Test',
            GIT_AUTHOR_EMAIL: 'test@example.invalid',
            GIT_COMMITTER_NAME: 'Test',
            GIT_COMMITTER_EMAIL: 'test@example.invalid',
          },
        });
      git('init', '-q');
      git('commit', '-q', '--allow-empty', '-m', 'candidate');
      const head = git('rev-parse', 'HEAD').stdout.toString().trim();
      expect(head).toMatch(/^[a-f0-9]{40}$/);
      const run = async (source: string) => {
        const output = join(checkout, '.output');
        await writeFile(output, '');
        const child = Bun.spawn(['bash', '-c', meta.run!], {
          cwd: checkout,
          env: {
            PATH: process.env.PATH,
            GITHUB_OUTPUT: output,
            // A candidate run's GITHUB_SHA is the dispatched ref's head.
            GITHUB_SHA: HEAD,
            SOURCE_SHA: source,
          },
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [code, stdout] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
        ]);
        return { code, stdout, output: await readFile(output, 'utf8') };
      };
      const labelled = await run(head);
      expect(labelled.code).toBe(0);
      expect(outputs(labelled.output).revision).toBe(head);
      const elsewhere = await run(HEAD);
      expect(elsewhere.code).not.toBe(0);
      expect(elsewhere.stdout).toContain(
        `::error::Checked out ${head}, expected ${HEAD}`,
      );
      expect(elsewhere.output).toBe('');
    },
  );

  test.skipIf(process.platform === 'win32')(
    'every pushed image leaves a digest receipt the later jobs read',
    async () => {
      const job = (await workflow()).jobs.build!;
      expect(step(job, 'Build and push').id).toBe('image');
      const record = step(job, 'Record image receipt');
      const upload = step(job, 'Upload image receipt');
      expect(job.if).toContain(
        'github.event.pull_request.head.repo.fork != true',
      );
      expect(step(job, 'Build and push').with?.push).toBe(true);
      expect(record.if).toBeUndefined();
      expect(upload.if).toBe(record.if);
      expect(record.env).toMatchObject({
        DIGEST: '${{ steps.image.outputs.digest }}',
        REVISION: '${{ steps.meta.outputs.revision }}',
        RECEIPTS: '${{ runner.temp }}/image-receipts',
      });
      expect(upload.uses).toBe(
        'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
      );
      expect(upload.with).toMatchObject({
        name: 'image-receipt-${{ matrix.service }}',
        path: '${{ runner.temp }}/image-receipts/${{ matrix.service }}.json',
        overwrite: true,
        'if-no-files-found': 'error',
      });
      const directory = await tempDirectory('tale-receipt-');
      const receiptOf = async (value: string) => {
        const result = await execute(record.run, {
          SERVICE: 'platform',
          IMAGE: 'ghcr.io/tale-project/tale/tale-platform',
          TAG: `candidate-sha-${CANDIDATE}`,
          DIGEST: value,
          REVISION: CANDIDATE,
          RECEIPTS: directory,
        });
        const written = await readFile(join(directory, 'platform.json'), 'utf8')
          .then((text) => JSON.parse(text) as unknown)
          .catch(() => null);
        await rm(join(directory, 'platform.json'), { force: true });
        return { ...result, written };
      };
      const recorded = await receiptOf(digest('platform'));
      expect(recorded.code, recorded.stdout + recorded.stderr).toBe(0);
      expect(recorded.written).toEqual({
        service: 'platform',
        image: 'ghcr.io/tale-project/tale/tale-platform',
        tag: `candidate-sha-${CANDIDATE}`,
        digest: digest('platform'),
        revision: CANDIDATE,
      });
      for (const value of ['', 'sha256:abc', `sha512:${'a'.repeat(64)}`]) {
        const refused = await receiptOf(value);
        expect(refused.code).not.toBe(0);
        expect(refused.stdout).toContain(
          '::error::The build of tale-platform reported no image digest',
        );
        expect(refused.written).toBeNull();
      }
    },
  );

  test.each(['image-validate', 'image-validate-fork'])(
    '%s installs workspace dependencies before running image checks',
    async (id) => {
      const job = (await workflow()).jobs[id]!;
      const setupIndex = job.steps.findIndex(
        (entry) => entry.uses === './.github/actions/setup-turbo',
      );
      expect(setupIndex).toBeGreaterThanOrEqual(0);
      const setup = job.steps[setupIndex]!;
      expect(setup.if).toBeUndefined();
      expect(setup.with?.['start-turbo-cache']).toBe('false');
      expect(setup.with?.['turbo-cache']).toBe('false');
      // Inherit the shared Bun pin and its frozen install. The conformance
      // helpers import workspace packages, which Bun alone cannot resolve.
      expect(setup.with?.['bun-version']).toBeUndefined();
      for (const entrypoint of [
        'container-image-test.ts',
        'container-sandbox-runtime-test.ts',
      ]) {
        const checkIndex = job.steps.findIndex((entry) =>
          entry.run?.includes(entrypoint),
        );
        expect(checkIndex).toBeGreaterThan(setupIndex);
      }
    },
  );

  describe.each(['smoke-test', 'image-validate'])('%s', (id) => {
    const pull = async () => {
      const job = (await workflow()).jobs[id]!;
      const download = step(job, 'Download image receipts');
      const pulling = step(job, 'Pull images from GHCR');
      expect(job.steps.indexOf(download)).toBeLessThan(
        job.steps.indexOf(pulling),
      );
      expect(download.uses).toBe(
        'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
      );
      expect(download.with).toEqual({
        pattern: 'image-receipt-*',
        path: '${{ runner.temp }}/image-receipts',
        'merge-multiple': true,
      });
      expect(pulling.env).toEqual({
        PULL_HELPER:
          "${{ needs.changes.outputs.candidate_sha != '' && '.ci-workflow/.github/scripts/pull-ci-images.sh' || '.github/scripts/pull-ci-images.sh' }}",
        REGISTRY_PATH: '${{ env.REGISTRY }}/${{ github.repository }}',
        SOURCE_SHA: '${{ needs.changes.outputs.source_sha }}',
        RECEIPTS: '${{ runner.temp }}/image-receipts',
      });
      return async (
        directory: string,
        foreign: {
          service?: string;
          revision?: string;
          failCommand?: string;
          failService?: string;
          trackPulls?: boolean;
        } = {},
      ) => {
        const tools = await standIns();
        const script = expand(pulling.run)?.replace(
          'bash "$PULL_HELPER"',
          `bash '${join(repository, '.github/scripts/pull-ci-images.sh')}'`,
        );
        const result = await execute(script, {
          PATH: tools.path,
          TEST_COMMAND_LOG: tools.log,
          TEST_REVISION: CANDIDATE,
          TEST_FOREIGN_SERVICE: foreign.service ?? '-',
          TEST_FOREIGN_REVISION: foreign.revision ?? '',
          TEST_FAIL_COMMAND: foreign.failCommand ?? '-',
          TEST_FAIL_SERVICE: foreign.failService ?? '-',
          TEST_TRACK_PULLS: String(foreign.trackPulls ?? false),
          REGISTRY_PATH: 'ghcr.io/tale-project/tale',
          SOURCE_SHA: CANDIDATE,
          RECEIPTS: directory,
        });
        return { ...result, calls: await tools.calls() };
      };
    };

    test.skipIf(process.platform === 'win32')(
      'pulls the recorded digests of the build matrix and checks their source',
      async () => {
        const run = await pull();
        const result = await run(
          await receipts(CANDIDATE, `candidate-sha-${CANDIDATE}`),
        );
        expect(result.code, result.stdout + result.stderr).toBe(0);
        const image = (service: string) =>
          `ghcr.io/tale-project/tale/tale-${service}@${digest(service)}`;
        expect(result.calls.toSorted()).toEqual(
          [
            ...BUILT.flatMap((service) => [
              `docker pull ${image(service)}`,
              `docker image inspect --format {{ index .Config.Labels "org.opencontainers.image.revision" }} ${image(service)}`,
              `docker tag ${image(service)} ghcr.io/tale-project/tale/tale-${service}:latest`,
            ]),
            ...['sandbox-runtime', 'sandbox-buildkitd'].map(
              (service) =>
                `docker tag ${image(service)} tale-${service}:latest`,
            ),
          ].toSorted(),
        );
        // Independent service workers may interleave, but each service must
        // finish pulling and pass source validation before its local tag.
        for (const service of BUILT) {
          const calls = result.calls.filter((call) =>
            call.includes(image(service)),
          );
          expect(calls[0]).toBe(`docker pull ${image(service)}`);
          expect(calls[1]).toStartWith('docker image inspect ');
          expect(
            calls.slice(2).every((call) => call.startsWith('docker tag ')),
          ).toBe(true);
        }
        // The loop pulls exactly what the build matrix builds.
        expect(BUILT.toSorted()).toEqual(
          (await workflow()).jobs.build!.strategy!.matrix!.service!.toSorted(),
        );
      },
    );

    test.skipIf(process.platform === 'win32')(
      'overlaps pulls, never exceeds three workers and waits before exposing the runtime tag',
      async () => {
        const run = await pull();
        const result = await run(await receipts(CANDIDATE, 'tag'), {
          trackPulls: true,
        });
        expect(result.code, result.stdout + result.stderr).toBe(0);
        let active = 0;
        let peak = 0;
        for (const call of result.calls) {
          if (call.startsWith('pull-start ')) {
            active += 1;
            peak = Math.max(peak, active);
          } else if (call.startsWith('pull-end ')) {
            active -= 1;
          } else if (call.endsWith(' tale-sandbox-runtime:latest')) {
            expect(active).toBe(0);
          }
          expect(active).toBeGreaterThanOrEqual(0);
          expect(active).toBeLessThanOrEqual(3);
        }
        expect(peak).toBe(3);
        expect(active).toBe(0);
        expect(
          result.calls.filter((call) => call.startsWith('pull-end ')),
        ).toHaveLength(BUILT.length);
      },
    );

    test
      .skipIf(process.platform === 'win32')
      .each(
        ['db', 'sandbox-buildkitd'].flatMap((service) =>
          ['pull', 'image', 'tag'].map(
            (command) => [service, command] as const,
          ),
        ),
      )(
      'propagates a %s %s failure from a worker, including its final image',
      async (service, command) => {
        const run = await pull();
        const result = await run(await receipts(CANDIDATE, 'tag'), {
          failService: service,
          failCommand: command,
          trackPulls: true,
        });
        expect(result.code).not.toBe(0);
        expect(result.stdout).toContain(
          `::error::Could not ${command === 'image' ? 'inspect' : command} tale-${service}`,
        );
        expect(
          result.calls.some((call) =>
            / tale-sandbox-(runtime|buildkitd):latest$/.test(call),
          ),
        ).toBe(false);
        expect(
          result.calls.filter((call) => call.startsWith('pull-end ')),
        ).toHaveLength(service === 'db' ? BUILT.length - 1 : BUILT.length);
        if (command === 'pull') {
          expect(
            result.calls.some(
              (call) =>
                call.startsWith('docker image inspect ') &&
                call.includes(`/tale-${service}@`),
            ),
          ).toBe(false);
        }
        if (command !== 'tag') {
          expect(
            result.calls.some((call) =>
              call.startsWith(
                `docker tag ghcr.io/tale-project/tale/tale-${service}@`,
              ),
            ),
          ).toBe(false);
        }
      },
    );

    test.skipIf(process.platform === 'win32')(
      'refuses an image without a receipt, a digest or the source revision',
      async () => {
        const run = await pull();
        const missing = await run(
          await receipts(CANDIDATE, 'tag', (service) =>
            service === 'proxy' ? null : {},
          ),
        );
        expect(missing.code).not.toBe(0);
        expect(missing.stdout).toContain(
          '::error::No image receipt with a digest for tale-proxy',
        );
        expect(missing.calls).toEqual([]);
        const malformed = await run(
          await receipts(CANDIDATE, 'tag', (service): Record<string, string> =>
            service === 'db' ? { digest: 'latest' } : {},
          ),
        );
        expect(malformed.code).not.toBe(0);
        expect(malformed.calls).toEqual([]);
        const foreign = await run(await receipts(CANDIDATE, 'tag'), {
          service: 'platform',
          revision: HEAD,
        });
        expect(foreign.code).not.toBe(0);
        expect(foreign.stdout).toContain(
          `::error::tale-platform was built from ${HEAD}, not ${CANDIDATE}`,
        );
        expect(
          foreign.calls.some((call) =>
            call.startsWith(
              'docker tag ghcr.io/tale-project/tale/tale-platform@',
            ),
          ),
        ).toBe(false);
      },
    );
  });

  describe('Candidate gate', () => {
    const gateJob = async () => (await workflow()).jobs['candidate-gate']!;
    const judge = async (
      results: Record<string, string>,
      directory: string,
    ) => {
      const summary = join(directory, 'summary.md');
      await writeFile(summary, '');
      const root = await tempDirectory('tale-candidate-gate-');
      const script = step(await gateJob(), 'Judge the candidate').run!;
      const child = Bun.spawn(['bash', '-c', script], {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          GITHUB_STEP_SUMMARY: summary,
          CANDIDATE_SHA: CANDIDATE,
          IMAGE_TAG: `candidate-sha-${CANDIDATE}`,
          NEEDS: JSON.stringify(
            Object.fromEntries(
              Object.entries(results).map(([job, result]) => [
                job,
                { result, outputs: {} },
              ]),
            ),
          ),
          RUN_ID: '36700000000',
          RUN_ATTEMPT: '2',
          RUN_URL:
            'https://github.com/tale-project/tale/actions/runs/36700000000',
          EVENT_NAME: 'repository_dispatch',
          WORKFLOW_SHA: HEAD,
          DISPATCH_REF: 'refs/heads/main',
          DISPATCH_SHA: HEAD,
          RECEIPTS: directory,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      const receipt = await readFile(
        join(root, 'release-candidate.json'),
        'utf8',
      )
        .then((text) => JSON.parse(text) as Record<string, unknown>)
        .catch(() => null);
      return {
        code,
        stdout,
        stderr,
        receipt,
        summary: await readFile(summary, 'utf8'),
      };
    };
    const passedJobs = async () =>
      Object.fromEntries(
        [(await gateJob()).needs ?? []].flat().map((job) => [job, 'success']),
      );

    test('needs every job a candidate runs, runs whatever they did, and only for a candidate', async () => {
      const build = await workflow();
      const job = await gateJob();
      expect(job.name).toBe('Candidate gate');
      // A new job in build.yml must be a candidate check or named here.
      const notCandidateChecks = new Set([
        'candidate-gate',
        'pr-scope',
        'ci-ready',
        'smoke-test-fork',
        'image-validate-fork',
        'vulnerability-scan',
      ]);
      expect([job.needs ?? []].flat().toSorted()).toEqual(
        Object.keys(build.jobs)
          .filter((id) => !notCandidateChecks.has(id))
          .toSorted(),
      );
      // The jobs it does not need never run for a candidate.
      for (const id of ['smoke-test-fork', 'image-validate-fork']) {
        expect(build.jobs[id]!.if).toContain(
          'github.event.pull_request.head.repo.fork == true',
        );
      }
      expect(build.jobs['vulnerability-scan']!.if).toContain(
        "needs.changes.outputs.scannable_services != '[]'",
      );
      expect(job.if).toBe(
        "always() && needs.changes.outputs.candidate_sha != ''",
      );
      expect(job.permissions).toEqual({});
      const download = step(job, 'Download image receipts');
      expect(download.with?.path).toBe('${{ runner.temp }}/image-receipts');
      expect(download['continue-on-error']).toBe(true);
      expect(step(job, 'Judge the candidate').env).toMatchObject({
        NEEDS: '${{ toJSON(needs) }}',
        CANDIDATE_SHA: '${{ needs.changes.outputs.candidate_sha }}',
        IMAGE_TAG: '${{ needs.changes.outputs.image_tag }}',
        RECEIPTS: '${{ runner.temp }}/image-receipts',
      });
      const upload = step(job, 'Upload candidate receipt');
      expect(upload.if).toBe(
        "always() && hashFiles('release-candidate.json') != ''",
      );
      expect(upload.with).toMatchObject({
        name: 'release-candidate-build-${{ needs.changes.outputs.candidate_sha }}-attempt-${{ github.run_attempt }}',
        path: 'release-candidate.json',
        'retention-days': 90,
      });
    });

    test.skipIf(process.platform === 'win32')(
      'passes only when every job succeeded, and keeps the source and digests',
      async () => {
        const directory = await receipts(
          CANDIDATE,
          `candidate-sha-${CANDIDATE}`,
        );
        const jobs = await passedJobs();
        const passed = await judge(jobs, directory);
        expect(passed.code, passed.stdout + passed.stderr).toBe(0);
        expect(passed.receipt).toEqual({
          schemaVersion: 1,
          workflow: '.github/workflows/build.yml',
          candidate: CANDIDATE,
          verdict: 'passed',
          run: {
            id: '36700000000',
            attempt: '2',
            url: 'https://github.com/tale-project/tale/actions/runs/36700000000',
            event: 'repository_dispatch',
            workflowSha: HEAD,
            ref: 'refs/heads/main',
            sha: HEAD,
          },
          jobs,
          images: BUILT.map((service) => ({
            service,
            image: `ghcr.io/tale-project/tale/tale-${service}`,
            tag: `candidate-sha-${CANDIDATE}`,
            digest: digest(service),
            revision: CANDIDATE,
          })),
        });
        expect(passed.summary).toContain(
          `## Release candidate \`${CANDIDATE}\`: passed`,
        );
        expect(passed.summary).toContain(
          `| ghcr.io/tale-project/tale/tale-db | \`${digest('db')}\` |`,
        );
      },
    );

    test.skipIf(process.platform === 'win32')(
      'a skipped, cancelled or failed job fails it; it never passes by omission',
      async () => {
        const directory = await receipts(
          CANDIDATE,
          `candidate-sha-${CANDIDATE}`,
        );
        for (const [job, result] of [
          ['web-test', 'skipped'],
          ['smoke-test', 'cancelled'],
          ['image-validate', 'failure'],
          ['build', 'skipped'],
        ] as const) {
          const failed = await judge(
            { ...(await passedJobs()), [job]: result },
            directory,
          );
          expect(failed.code).not.toBe(0);
          expect(failed.stdout).toContain(
            `::error::${job} did not succeed for release candidate ${CANDIDATE} (${result})`,
          );
          expect(failed.receipt).toMatchObject({
            verdict: 'failed',
            jobs: { [job]: result },
          });
          expect(failed.summary).toContain(
            `## Release candidate \`${CANDIDATE}\`: failed`,
          );
        }
      },
    );

    test.skipIf(process.platform === 'win32')(
      'an image receipt that is missing or not of the candidate fails it',
      async () => {
        const cases: [
          string,
          (service: string) => Record<string, string> | null,
        ][] = [
          ['sandbox', (service) => (service === 'sandbox' ? null : {})],
          [
            'proxy',
            (service) => (service === 'proxy' ? { revision: HEAD } : {}),
          ],
          [
            'db',
            (service) => (service === 'db' ? { tag: `sha-${CANDIDATE}` } : {}),
          ],
          [
            'sandbox-runtime',
            (service) =>
              service === 'sandbox-runtime' ? { digest: 'sha256:abc' } : {},
          ],
          [
            'platform',
            (service) => (service === 'platform' ? { service: 'db' } : {}),
          ],
        ];
        for (const [service, change] of cases) {
          const failed = await judge(
            await passedJobs(),
            await receipts(CANDIDATE, `candidate-sha-${CANDIDATE}`, change),
          );
          expect(failed.code).not.toBe(0);
          expect(failed.stdout).toContain(
            `::error::No image receipt of tale-${service} built from ${CANDIDATE}`,
          );
          expect(failed.receipt).toMatchObject({ verdict: 'failed' });
          const images = (failed.receipt?.images ?? []) as {
            service: string;
          }[];
          expect(images.map((image) => image.service)).not.toContain(service);
        }
      },
    );
  });
});

/** A stand-in for the `gh` the cleanup step runs. It logs each call, then
 * answers with the next reply of the listing or the deletion queue: `ok`, or
 * the HTTP status the call fails with, in gh's own error format. A listing
 * that succeeds prints the page through the step's own `--jq` filter. */
const GH_STAND_IN = `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_COMMAND_LOG"
if [ "$2" = -X ]; then
  replies=$TEST_DELETE_REPLIES
  call=$(grep -c '^api -X DELETE ' "$TEST_COMMAND_LOG")
else
  replies=$TEST_LIST_REPLIES
  call=$(grep -c ' --paginate ' "$TEST_COMMAND_LOG")
fi
reply=$(printf '%s\\n' $replies | sed -n "\${call}p")
case "$reply" in
  ok) ;;
  '') echo "gh: unexpected call: $*" >&2; exit 2 ;;
  *) echo "gh: Stand-in failure. (HTTP $reply)" >&2; exit 1 ;;
esac
[ "$2" = -X ] && exit 0
while [ $# -gt 1 ]; do
  [ "$1" = --jq ] && filter=$2
  shift
done
jq -r "$filter" "$TEST_VERSIONS"
`;

/** Runs the PR-image cleanup step's script for PR 7 against the stand-in. */
async function cleanup(
  service: string,
  replies: { list: string[]; remove?: string[] },
  versions: unknown[] = [],
) {
  const workflow = parse(
    await readFile(
      join(repository, '.github/workflows/cleanup-pr-images.yml'),
      'utf8',
    ),
  ) as { jobs: { delete: { steps: Step[] } } };
  const root = await mkdtemp(join(tmpdir(), 'tale-cleanup-pr-images-'));
  roots.push(root);
  const bin = join(root, 'bin');
  const log = join(root, 'calls');
  const summary = join(root, 'summary');
  const page = join(root, 'versions.json');
  await mkdir(bin);
  await writeFile(log, '');
  await writeFile(summary, '');
  await writeFile(page, JSON.stringify(versions));
  await writeFile(join(bin, 'gh'), GH_STAND_IN, { mode: 0o755 });
  // The retry backoff (2 s, then 4 s) would only slow the suite down.
  await writeFile(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const result = await execute(
    workflow.jobs.delete.steps.find(
      (step) => step.name === 'Delete PR-tagged versions',
    )?.run,
    {
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_STEP_SUMMARY: summary,
      TEST_COMMAND_LOG: log,
      TEST_LIST_REPLIES: replies.list.join(' '),
      TEST_DELETE_REPLIES: (replies.remove ?? []).join(' '),
      TEST_VERSIONS: page,
      PR: '7',
      SVC: service,
      OWNER: 'tale-project',
    },
  );
  const calls = (await readFile(log, 'utf8')).split('\n').filter(Boolean);
  return {
    ...result,
    summary: await readFile(summary, 'utf8'),
    listings: calls.filter((call) => call.includes(' --paginate ')).length,
    deletions: calls
      .filter((call) => call.startsWith('api -X DELETE '))
      .map((call) => call.split(' ')[3]?.split('/').at(-1)),
  };
}

test.skipIf(process.platform === 'win32')(
  'PR-image cleanup finds nothing to clean in a package that does not exist',
  async () => {
    const result = await cleanup('convex', { list: ['404'] });
    expect(result.code, result.stdout + result.stderr).toBe(0);
    // A 404 is an answer, not a blip: one listing, no retry.
    expect(result.listings).toBe(1);
    expect(result.deletions).toEqual([]);
    // The matrix tracks build.yml, so a 404 names the two causes left: an
    // image never pushed, or a package this repository lost access to.
    expect(result.stdout).toContain(
      '::warning::Package tale-convex not found or not visible to this token (HTTP 404)',
    );
    expect(result.stdout).toContain('Manage Actions access');
    expect(result.summary).toContain(
      'package tale-convex was not found or is not visible to this token; no versions cleaned',
    );
  },
);

test.skipIf(process.platform === 'win32')(
  'PR-image cleanup retries a failed listing and fails the job when the error persists',
  async () => {
    const recovered = await cleanup('platform', { list: ['502', 'ok'] });
    expect(recovered.code, recovered.stdout + recovered.stderr).toBe(0);
    expect(recovered.listings).toBe(2);
    expect(recovered.summary).toContain('No `pr-7-sha-*` versions found');
    const refused = await cleanup('platform', { list: ['403', '403', '403'] });
    expect(refused.code).toBe(1);
    expect(refused.listings).toBe(3);
    // gh's own error still reaches the job log.
    expect(refused.stderr).toContain('(HTTP 403)');
    expect(refused.stdout).toContain(
      '::error::Failed to list versions of tale%2Ftale-platform after 3 attempts',
    );
  },
);

test.skipIf(process.platform === 'win32')(
  "PR-image cleanup deletes only the closed PR's tags",
  async () => {
    const version = (id: number, ...tags: string[]) => ({
      id,
      metadata: { container: { tags } },
    });
    const result = await cleanup(
      'platform',
      { list: ['ok'], remove: ['ok', '404'] },
      [
        version(1, `pr-7-sha-${'a'.repeat(40)}`),
        version(2, `pr-70-sha-${'a'.repeat(40)}`),
        version(3, `sha-${'a'.repeat(40)}`),
        version(4),
        version(5, `pr-7-sha-${'b'.repeat(40)}`),
      ],
    );
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.deletions).toEqual(['1', '5']);
    // A version gone before its delete (a duplicate run, say) is no failure.
    expect(result.summary).toContain(
      '- Deleted: 1\n- Already gone (404): 1\n- Failures: 0',
    );
  },
);

describe('standalone container CI efficiency', () => {
  const SERVICES = ['web', 'docs', 'ui-docs', 'ai-gateway'] as const;
  const workflow = async () =>
    parse(
      await readFile(join(repository, '.github/workflows/build.yml'), 'utf8'),
    ) as {
      jobs: Record<string, { steps: Step[] }>;
    };

  test.skipIf(process.platform === 'win32').each([
    ['ample space', '25000000', false],
    ['low space', '2000000', true],
    ['just below 20 GiB', '20971519', true],
    ['the 20 GiB threshold', '20971520', false],
  ] as const)(
    'only reclaims preinstalled SDKs with %s',
    async (_, available, reclaim) => {
      const jobs = (await workflow()).jobs;
      const script = jobs['web-test']?.steps.find(
        (step) => step.name === 'Reclaim disk space if needed',
      )?.run;
      for (const service of SERVICES) {
        expect(
          jobs[`${service}-test`]?.steps.find(
            (step) => step.name === 'Reclaim disk space if needed',
          )?.run,
        ).toBe(script);
      }
      const result = await execute(
        script,
        { TEST_AVAILABLE: available },
        {
          df: '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted on\\nsynthetic 10000000 1000000 %s 10%% /\\n" "$TEST_AVAILABLE"\n',
          sudo: '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PROOF_DIR/reclaim-calls"\n',
        },
      );
      expect(result.code, result.stdout + result.stderr).toBe(0);
      const calls = Bun.file(join(result.root, 'reclaim-calls'));
      expect(await calls.exists()).toBe(reclaim);
      if (reclaim) {
        expect(await calls.text()).toBe(
          'rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc /opt/hostedtoolcache/CodeQL\ndocker image prune -af\n',
        );
      }
    },
  );

  test
    .skipIf(process.platform === 'win32')
    .each([
      '#!/bin/sh\nexit 27\n',
      '#!/bin/sh\nprintf "unreadable free space\\n"\n',
    ])('fails when free disk space cannot be measured', async (df) => {
    const script = (await workflow()).jobs['web-test']?.steps.find(
      (step) => step.name === 'Reclaim disk space if needed',
    )?.run;
    expect((await execute(script, {}, { df })).code).not.toBe(0);
  });
});

test.skipIf(process.platform === 'win32')(
  'setup action selects the host binary, honours linux-baseline on x64 only and seals only the final Mac executable',
  async () => {
    const action = parse(
      await readFile(
        join(repository, '.github/actions/setup-cli/action.yml'),
        'utf8',
      ),
    ) as { runs: { steps: Step[] } };
    const script = action.runs.steps.find((step) => step.id === 'build')?.run;
    if (!script) throw new Error('Setup build script missing');
    // Without a build script, the runner/baseline pair is one the step refuses.
    const cases: Array<[string, string, string, string?]> = [
      ['Linux', 'X64', 'false', 'build:linux'],
      ['Linux', 'X64', 'true', 'build:linux-baseline'],
      ['Linux', 'ARM64', 'false', 'build:linux-arm64'],
      ['Linux', 'ARM64', 'true'],
      ['macOS', 'ARM64', 'false', 'build:mac'],
      ['macOS', 'ARM64', 'true'],
    ];
    for (const [os, arch, baseline, build] of cases) {
      const root = await realpath(
        await mkdtemp(join(tmpdir(), 'tale-setup-build-')),
      );
      roots.push(root);
      const bin = join(root, 'bin');
      const log = join(root, 'commands');
      const output = join(root, 'output');
      const path = join(root, 'path');
      await mkdir(bin);
      await mkdir(join(root, 'tools/cli/dist'), { recursive: true });
      await writeFile(log, '');
      await writeFile(output, '');
      await writeFile(path, '');
      await writeFile(
        join(bin, 'git'),
        '#!/bin/sh\nif [ "$1" = rev-parse ]; then printf "%s\\n" "$TALE_CLI_REVISION"; fi\n',
        { mode: 0o755 },
      );
      for (const command of ['bun', 'codesign'])
        await writeFile(
          join(bin, command),
          `#!/bin/sh\nprintf '%s\\n' '${command}'" $*" >> "$TEST_COMMAND_LOG"\n`,
          { mode: 0o755 },
        );
      await writeFile(
        join(root, 'tools/cli/dist/tale'),
        '#!/bin/sh\nexit 0\n',
        { mode: 0o755 },
      );
      const child = Bun.spawn(
        [process.platform === 'darwin' ? '/bin/bash' : 'bash', '-c', script],
        {
          cwd: root,
          env: {
            PATH: `${bin}:${process.env.PATH}`,
            GITHUB_OUTPUT: output,
            GITHUB_PATH: path,
            TEST_COMMAND_LOG: log,
            RUNNER_OS: os,
            RUNNER_ARCH: arch,
            TALE_CLI_REVISION: 'a'.repeat(40),
            TALE_CLI_LINUX_BASELINE: baseline,
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      const calls = (await readFile(log, 'utf8')).trim().split('\n');
      if (!build) {
        expect(code, stdout + stderr).not.toBe(0);
        expect(stdout).toContain('::error::');
        expect(calls.some((call) => call.includes(' build:'))).toBe(false);
        expect(await readFile(output, 'utf8')).toBe('');
        continue;
      }
      expect(code, stdout + stderr).toBe(0);
      expect(calls).toContain(`bun run --filter @tale/cli ${build}`);
      // Every supported runner also ships the interpreted bundle the
      // backend-local provision phase runs under the target's own bun.
      expect(calls).toContain('bun run --filter @tale/cli build:backend-local');
      expect(calls.filter((call) => call.startsWith('codesign'))).toEqual(
        os === 'macOS'
          ? [
              'codesign --remove-signature tools/cli/dist/tale',
              'codesign -s - tools/cli/dist/tale',
              'codesign --verify --strict --verbose=2 tools/cli/dist/tale',
            ]
          : [],
      );
      expect(calls.at(-1)).toBe('bun run --filter @tale/cli check:bundle');
      expect(await readFile(output, 'utf8')).toBe(
        `executable=${root}/tools/cli/dist/tale\n`,
      );
    }
  },
  30_000,
);

test.skipIf(process.platform === 'win32')(
  'setup action rejects mutable pins and unsupported runners before checkout or build',
  async () => {
    const action = parse(
      await readFile(
        join(repository, '.github/actions/setup-cli/action.yml'),
        'utf8',
      ),
    ) as { runs: { steps: Step[] } };
    const steps = action.runs.steps;
    const script = steps[0]?.run;
    const environment = {
      TALE_CLI_REVISION: 'a'.repeat(40),
      RUNNER_OS: 'Linux',
      RUNNER_ARCH: 'X64',
      TALE_CLI_LINUX_BASELINE: 'false',
    };
    expect((await execute(script, environment)).code).toBe(0);
    expect(
      (await execute(script, { ...environment, RUNNER_ARCH: 'ARM64' })).code,
    ).toBe(0);
    expect(
      (
        await execute(script, {
          ...environment,
          RUNNER_OS: 'macOS',
          RUNNER_ARCH: 'ARM64',
        })
      ).code,
    ).toBe(0);
    expect(
      (
        await execute(script, {
          ...environment,
          TALE_CLI_LINUX_BASELINE: 'true',
        })
      ).code,
    ).toBe(0);
    const refused = await execute(script, {
      ...environment,
      TALE_CLI_LINUX_BASELINE: 'true',
      RUNNER_ARCH: 'ARM64',
    });
    expect(refused.code).not.toBe(0);
    expect(refused.stdout).toContain(
      '::error::Tale setup linux-baseline requires a Linux x64 runner',
    );
    for (const changed of [
      { TALE_CLI_REVISION: 'main' },
      { TALE_CLI_REVISION: 'v1.2.3' },
      { TALE_CLI_REVISION: `${environment.TALE_CLI_REVISION}\n` },
      { RUNNER_OS: 'Windows' },
      { RUNNER_OS: 'macOS', RUNNER_ARCH: 'X64' },
      { RUNNER_ARCH: 'X86' },
      {
        TALE_CLI_LINUX_BASELINE: 'true',
        RUNNER_OS: 'macOS',
        RUNNER_ARCH: 'ARM64',
      },
      { TALE_CLI_LINUX_BASELINE: 'yes' },
    ]) {
      expect(
        (await execute(script, { ...environment, ...changed })).code,
      ).not.toBe(0);
    }
    const checkout = steps.find((step) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    expect(checkout?.with).toMatchObject({
      repository: 'tale-project/tale',
      ref: '${{ inputs.revision }}',
      'persist-credentials': false,
    });
    expect(steps.find((step) => step.id === 'build')?.run).toContain(
      'git status --porcelain --untracked-files=all',
    );
  },
);

describe('the Backend integration check', () => {
  type Job = {
    if?: string;
    'timeout-minutes'?: number;
    env?: Record<string, string>;
    steps: Step[];
  };
  const checks = async () =>
    parse(
      await readFile(join(repository, '.github/workflows/checks.yml'), 'utf8'),
    ) as { jobs: Record<string, Job> };

  test('is owed by every push, merge group and candidate, and by a pull request that touches what the suite runs', async () => {
    const decision = (await checks()).jobs['integration-scope']?.steps.find(
      (step) => step.id === 'decide',
    );
    // The shared action's executable before/after API and event fixtures
    // live in ci-ready-workflows.test.ts. Empty scope now fails closed.
    expect(decision?.uses).toBe('./.github/actions/ci-scope');
    expect(decision?.with?.filter).toBe('integration');
  });

  test.skipIf(process.platform === 'win32')(
    "starts the object store the CLI deploys, read from the CLI's own pin",
    async () => {
      const script = (await checks()).jobs['backend-integration']?.steps.find(
        (step) => step.id === 'object-store',
      )?.run;
      // Read at run time, so a pin bump moves the job with it.
      expect(script).toContain("THIRD_PARTY_IMAGES['object-store']");
      const result = await execute(`cd "$REPOSITORY"\n${script}`, {
        REPOSITORY: repository,
      });
      expect(result.code, result.stderr).toBe(0);
      expect(result.output).toBe(
        `image=${THIRD_PARTY_IMAGES['object-store']}\n`,
      );
    },
  );

  test('runs every lane against the tale-db it builds, straight through the script', async () => {
    const job = (await checks()).jobs['backend-integration'];
    const steps = job?.steps ?? [];
    const run = steps.find((step) => step.name === 'Run backend integration');
    // Straight through the script: no turbo cache can replay the verdict.
    expect(run?.run).toContain('bun run backend:integration');
    expect(run?.run).not.toContain('turbo');
    expect(run?.env?.ITEST_REQUIRE_ALL_LANES).toBe('1');
    expect(run?.env?.ITEST_S3_ENDPOINT).toBeTruthy();
    expect(job?.env?.ITEST_S3_ACCESS_KEY).toBeTruthy();
    expect(job?.env?.ITEST_S3_SECRET_KEY).toBeTruthy();
    const build = steps.find((step) =>
      step.uses?.startsWith('docker/build-push-action@'),
    )?.with;
    expect(build).toMatchObject({
      file: 'services/db/Dockerfile',
      push: false,
    });
    // The containers it starts are the image it built and the pinned store,
    // not a registry tag that happens to share the name.
    const start = steps.find(
      (step) => step.name === 'Start tale-db and the object store',
    );
    // Each `docker run`, its continuation lines joined, as its words.
    const dockerRun = (name: string) =>
      (start?.run ?? '')
        .replaceAll('\\\n', ' ')
        .split('\n')
        .find((line) => line.includes(`docker run -d --name ${name} `))
        ?.trim()
        .split(/\s+/);
    // The image is the first word after the options: the last one for the
    // database, the one before its `server` command for the store.
    expect(dockerRun('tale-itest-db')?.at(-1)).toBe(String(build?.tags));
    const store = dockerRun('tale-itest-object-store') ?? [];
    expect(store[store.indexOf('server') - 1]).toBe('"$OBJECT_STORE_IMAGE"');
    expect(start?.env?.OBJECT_STORE_IMAGE).toBe(
      '${{ steps.object-store.outputs.image }}',
    );
    expect(job?.['timeout-minutes']).toBeGreaterThan(0);
    expect(job?.if).toContain("needs.integration-scope.outputs.run == 'true'");
  });

  test.skipIf(process.platform === 'win32')(
    'fails, never reads skipped, when the scope job did not decide',
    async () => {
      const job = (await checks()).jobs['backend-integration'];
      expect(job?.if).toContain('!cancelled()');
      expect(job?.if).toContain("needs.integration-scope.result != 'success'");
      const [first] = job?.steps ?? [];
      expect(first?.if).toBe("needs.integration-scope.result != 'success'");
      const result = await execute(first?.run, { SCOPE: 'failure' });
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('Integration scope ended failure');
    },
  );

  test('owes the proof to a pull request that touches the backend, the database image or the pin', async () => {
    const { integration } = parse(
      await readFile(join(repository, '.github/ci-scope.yml'), 'utf8'),
    ) as {
      integration: string[];
    };
    // The whole list is held to the harness's module graph by the platform's
    // tests/guards/integration-scope.guard.test.ts; these are the entries no
    // import names.
    expect(integration).toEqual(
      expect.arrayContaining([
        'services/platform/backend/**',
        'services/db/**',
        'tools/cli/src/lib/compose/types.ts',
        'services/platform/Dockerfile',
        '.github/workflows/checks.yml',
      ]),
    );
  });

  test('retains raw integration evidence on success and failure', async () => {
    const job = (await checks()).jobs['backend-integration'];
    const steps = job?.steps ?? [];
    const proof = steps.find(
      (step) => step.name === 'Prepare integration evidence',
    );
    expect(proof?.run).toContain('checked_out_sha="$(git rev-parse HEAD)"');
    expect(proof?.run).toContain('echo "source=$checked_out_sha"');
    expect(proof?.run).toContain('workflow-sha=$GITHUB_SHA');
    expect(proof?.run).toContain(
      'services/platform/backend/integration-check.ts',
    );
    const tooling = steps.find((step) => step.name === 'Install ffmpeg');
    expect(tooling?.run).toContain('"$PROOF_DIR/toolchain.txt"');
    const retain = steps.find(
      (step) => step.name === 'Retain integration service logs',
    );
    expect(retain?.if).toBe('always()');
    expect(retain?.run).toContain('"$PROOF_DIR/db.log"');
    expect(retain?.run).toContain('"$PROOF_DIR/object-store.log"');
    const upload = steps.find(
      (step) => step.name === 'Upload integration evidence',
    );
    expect(upload?.if).toBe('always()');
    expect(upload?.uses).toMatch(/^actions\/upload-artifact@[a-f0-9]{40}$/);
    expect(upload?.with).toMatchObject({
      name: 'backend-integration-${{ github.run_id }}-${{ github.run_attempt }}',
      'if-no-files-found': 'error',
      'retention-days': 14,
    });
    expect(upload?.with?.path).toBe(
      '${{ env.PROOF_DIR }}/*.txt\n${{ env.PROOF_DIR }}/*.log\n',
    );
    expect(upload?.with?.path).not.toMatch(/config|builtin/);
  });

  test.skipIf(process.platform === 'win32')(
    'records the checked-out source separately from the workflow source',
    async () => {
      const script = (await checks()).jobs['backend-integration']?.steps.find(
        (step) => step.name === 'Prepare integration evidence',
      )?.run;
      const workflowSource = 'f'.repeat(40);
      const result = await execute(`cd "$REPOSITORY"\n${script ?? ''}`, {
        REPOSITORY: repository,
        GITHUB_RUN_ID: '77',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_EVENT_NAME: 'repository_dispatch',
        GITHUB_SHA: workflowSource,
      });
      expect(script).toBeDefined();
      expect(result.code, result.stderr).toBe(0);
      const proof = join(result.root, 'backend-integration-77-2');
      const source = await readFile(join(proof, 'source.txt'), 'utf8');
      const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], {
        cwd: repository,
      });
      expect(head.exitCode, head.stderr.toString()).toBe(0);
      expect(source).toStartWith(`source=${head.stdout.toString().trim()}\n`);
      expect(source).not.toContain(`source=${workflowSource}\n`);
      expect(source).toContain(`workflow-sha=${workflowSource}\n`);
      expect(source).toContain('run=77 attempt=2\n');
      expect(source).toMatch(/[a-f0-9]{64}  services\/db\/Dockerfile\n/);
      expect(await readFile(join(result.root, 'environment'), 'utf8')).toBe(
        `PROOF_DIR=${proof}\n`,
      );
    },
  );

  test.skipIf(process.platform === 'win32')(
    'fails when the checked-out source cannot be read',
    async () => {
      const script = (await checks()).jobs['backend-integration']?.steps.find(
        (step) => step.name === 'Prepare integration evidence',
      )?.run;
      const result = await execute(
        `cd "$REPOSITORY"\n${script ?? ''}`,
        {
          REPOSITORY: repository,
          GITHUB_RUN_ID: '77',
          GITHUB_RUN_ATTEMPT: '2',
          GITHUB_EVENT_NAME: 'repository_dispatch',
          GITHUB_SHA: 'f'.repeat(40),
        },
        {
          git: '#!/bin/sh\nprintf "synthetic git identity failure\\n" >&2\nexit 73\n',
        },
      );
      expect(script).toBeDefined();
      expect(result.code, result.stderr).toBe(73);
      expect(result.stderr).toBe('synthetic git identity failure\n');
      expect(
        await Bun.file(
          join(result.root, 'backend-integration-77-2', 'source.txt'),
        ).exists(),
      ).toBe(false);
    },
  );

  test.skipIf(process.platform === 'win32').each([
    ['2', '0', true],
    ['1', '0', false],
    ['0', '0', false],
    ['2', '7', false],
  ] as const)(
    'requires both database extensions: count %s, query exit %s',
    async (count, queryExit, accepted) => {
      const script = (await checks()).jobs['backend-integration']?.steps.find(
        (step) => step.name === 'Verify and record integration services',
      )?.run;
      const result = await execute(
        script,
        {
          TEST_EXTENSION_COUNT: count,
          TEST_QUERY_EXIT: queryExit,
          OBJECT_STORE_IMAGE: THIRD_PARTY_IMAGES['object-store'],
        },
        {
          docker: `#!/bin/sh
printf '%s\n' "$*" >> "$PROOF_DIR/docker-calls.txt"
case "$*" in
  *"SELECT count(*) FROM pg_extension WHERE extname IN ('pg_search', 'vector')"*)
    printf '%s\n' "$TEST_EXTENSION_COUNT"; exit "$TEST_QUERY_EXIT" ;;
  *"SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_search', 'vector')"*)
    if [ "$TEST_EXTENSION_COUNT" = 2 ]; then printf 'pg_search|0.22.6\n'; fi
    if [ "$TEST_EXTENSION_COUNT" != 0 ]; then printf 'vector|0.8.1\n'; fi ;;
  'image inspect --format '* )
    printf 'sha256:db []\nsha256:store ["synthetic@sha256:store"]\n' ;;
  *) echo 'unexpected docker arguments' >&2; exit 99 ;;
esac
`,
        },
      );
      expect(result.code === 0, result.stderr).toBe(accepted);
      const calls = await readFile(
        join(result.root, 'docker-calls.txt'),
        'utf8',
      );
      expect(await readFile(join(result.root, 'extensions.txt'), 'utf8')).toBe(
        count === '2'
          ? 'pg_search|0.22.6\nvector|0.8.1\n'
          : count === '1'
            ? 'vector|0.8.1\n'
            : '',
      );
      if (accepted) {
        expect(
          await readFile(join(result.root, 'images.txt'), 'utf8'),
        ).toContain('sha256:db');
      } else {
        expect(calls).not.toContain('image inspect');
      }
    },
  );

  test.skipIf(process.platform === 'win32').each([0, 1, 2])(
    'keeps integration exit %i and its raw stdout/stderr through tee',
    async (code) => {
      const step = (await checks()).jobs['backend-integration']?.steps.find(
        (candidate) => candidate.name === 'Run backend integration',
      );
      const result = await execute(
        step?.run,
        {
          ITEST_REQUIRE_ALL_LANES: String(step?.env?.ITEST_REQUIRE_ALL_LANES),
          TALE_CONFIG_DIR: 'config',
          TALE_CONFIG_BUILTIN_DIR: 'builtin',
          LANE_EXIT: String(code),
        },
        {
          node: '#!/bin/sh\n[ "$*" = --version ] || exit 97\nprintf "v22.21.1\n"\n',
          bun: `#!/bin/sh
[ "$*" = 'run backend:integration' ] || exit 99
[ "$ITEST_REQUIRE_ALL_LANES" = 1 ] || exit 98
printf 'synthetic lane: exit %s\n' "$LANE_EXIT"
printf 'synthetic diagnostic\n' >&2
exit "$LANE_EXIT"
`,
        },
      );
      expect(result.code, result.stderr).toBe(code);
      expect(await readFile(join(result.root, 'exit-code.txt'), 'utf8')).toBe(
        `${code}\n`,
      );
      expect(
        await readFile(join(result.root, 'backend-integration.log'), 'utf8'),
      ).toBe(`synthetic lane: exit ${code}\nsynthetic diagnostic\n`);
    },
  );

  test.skipIf(process.platform === 'win32')(
    'retains raw service diagnostics when preparation never completed',
    async () => {
      const script = (await checks()).jobs['backend-integration']?.steps.find(
        (step) => step.name === 'Retain integration service logs',
      )?.run;
      const result = await execute(
        script,
        {
          PROOF_DIR: '',
          GITHUB_RUN_ID: '77',
          GITHUB_RUN_ATTEMPT: '2',
        },
        {
          docker:
            '#!/bin/sh\nprintf "synthetic container unavailable\n" >&2\nexit 1\n',
        },
      );
      expect(result.code, result.stderr).toBe(0);
      const proof = join(result.root, 'backend-integration-77-2');
      for (const log of ['db.log', 'object-store.log']) {
        expect(await readFile(join(proof, log), 'utf8')).toBe(
          'synthetic container unavailable\n',
        );
      }
      expect(await readFile(join(result.root, 'environment'), 'utf8')).toBe(
        `PROOF_DIR=${proof}\n`,
      );
    },
  );
});

/** Playwright diagnostics (#4013): a flake the retry recovered leaves its job
 * green, so its report and test results cannot wait for `failure()`. The
 * platform shards and the static sites are one concept, held to one shape. */
describe('Playwright diagnostics', () => {
  const e2e = async () =>
    parse(
      await readFile(join(repository, '.github/workflows/e2e.yml'), 'utf8'),
    ) as { jobs: Record<string, { steps: Step[] }> };
  // Job, the service directory its suite writes into, the artifact's stem.
  const SITES = [
    ['e2e', 'services/platform', 'playwright-report-shard-${{ matrix.shard }}'],
    [
      'static-sites',
      'services/${{ matrix.service }}',
      'playwright-report-${{ matrix.service }}',
    ],
  ] as const;
  const pair = async (job: string) => {
    const steps = (await e2e()).jobs[job]?.steps ?? [];
    const index = steps.findIndex(
      (step) => step.name === 'Find Playwright diagnostics',
    );
    return { steps, index, find: steps[index], upload: steps[index + 1] };
  };

  test.each(SITES)(
    '%s uploads the report and test results of a failure or a recovered flake',
    async (job, service, stem) => {
      const { steps, index, find, upload } = await pair(job);
      const suite = steps.findIndex((step) =>
        /playwright test|test:e2e/.test(step.run ?? ''),
      );
      expect(suite).toBeGreaterThanOrEqual(0);
      expect(index).toBeGreaterThan(suite);
      expect(find).toMatchObject({
        id: 'diagnostics',
        'working-directory': service,
      });
      // No condition: it runs only while the job is green. A failed job
      // uploads through `failure()` as it always did.
      expect(find?.if).toBeUndefined();
      expect(upload?.name).toBe('Upload Playwright report');
      expect(upload?.if).toBe(
        "failure() || steps.diagnostics.outputs.found == 'true'",
      );
      expect(upload?.uses).toBe(
        'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
      );
      // The same two directories and retention, hidden files left out (the
      // default); one artifact per attempt, because a re-run that uploads
      // the name an earlier attempt used fails with 409 Conflict.
      expect(upload?.with).toEqual({
        name: `${stem}-attempt-\${{ github.run_attempt }}`,
        path: `${service}/playwright-report/\n${service}/test-results/\n`,
        'retention-days': 14,
        'if-no-files-found': 'ignore',
      });
    },
  );

  test('both jobs decide with the same step', async () => {
    const [platform, sites] = await Promise.all(
      SITES.map(([job]) => pair(job)),
    );
    expect(platform?.find?.run).toContain('found=true');
    expect(sites?.find?.run).toBe(platform?.find?.run);
  });

  // What Playwright 1.58 leaves in test-results/ under `@tale/e2e/config`.
  const FLAKE =
    'specs-changelog-changelog--f61e0-e-link-updates-aria-current-chromium';
  const LAST_RUN = { '.last-run.json': '{"status":"passed","failedTests":[]}' };
  test.skipIf(process.platform === 'win32').each([
    ['no test results', 'false', null],
    ['only the last-run record of a clean run', 'false', LAST_RUN],
    [
      'a recovered flake',
      'true',
      {
        ...LAST_RUN,
        [`${FLAKE}/test-failed-1.png`]: 'png',
        [`${FLAKE}/error-context.md`]: '# Page snapshot',
        [`${FLAKE}-retry1/trace.zip`]: 'zip',
        '.playwright-artifacts-0/stale': 'hidden',
      },
    ],
  ] as const)(
    'finds diagnostics after %s: found=%s',
    async (_, found, files) => {
      const service = await mkdtemp(join(tmpdir(), 'tale-playwright-'));
      roots.push(service);
      for (const [path, body] of Object.entries(files ?? {})) {
        const file = join(service, 'test-results', path);
        await mkdir(join(file, '..'), { recursive: true });
        await writeFile(file, body);
      }
      const { find } = await pair('e2e');
      // GitHub runs a step as `bash -e {0}` in its working directory.
      const result = await execute(`set -e\ncd "$SERVICE"\n${find?.run}`, {
        SERVICE: service,
      });
      expect(result.code, result.stderr).toBe(0);
      expect(result.output).toBe(`found=${found}\n`);
      if (found === 'true') {
        expect(result.stdout).toBe(
          `::notice title=Playwright diagnostics::A test failed before its retry passed; keeping ${FLAKE} ${FLAKE}-retry1\n`,
        );
      } else {
        expect(result.stdout).not.toContain('::notice');
      }
    },
  );

  // A listing that could not be read is no clean run: the step fails, the
  // upload then runs through `failure()`, and neither `found=false` nor the
  // clean-run line is written. Under plain `bash -e` the pipeline took its
  // status from `paste`, so a failed `find` read as a clean run.
  const UNREAD =
    '::error title=Playwright diagnostics::Could not read test-results/, so this run is not reported clean\n';
  // Stand-ins fail one stage the same way for every user, root included.
  const STAGES = [
    [
      'find lists nothing',
      'find',
      `#!/bin/sh\necho "find: 'test-results': Permission denied" >&2\nexit 1\n`,
    ],
    [
      'find stops part-way',
      'find',
      `#!/bin/sh\necho "test-results/${FLAKE}"\necho "find: 'test-results': Input/output error" >&2\nexit 1\n`,
    ],
    [
      'a later stage fails',
      'sort',
      `#!/bin/sh\ncat > /dev/null\necho 'sort: write failed: standard output' >&2\nexit 2\n`,
    ],
  ] as const;
  test
    .skipIf(process.platform === 'win32')
    .each(
      SITES.flatMap(([job]) =>
        STAGES.map(
          ([when, command, standIn]) => [job, when, command, standIn] as const,
        ),
      ),
    )(
    '%s fails, and never reports a clean run, when %s',
    async (job, _, command, standIn) => {
      const service = await mkdtemp(join(tmpdir(), 'tale-playwright-'));
      roots.push(service);
      await mkdir(join(service, 'test-results', `${FLAKE}-retry1`), {
        recursive: true,
      });
      const { find } = await pair(job);
      const result = await execute(
        `set -e\ncd "$SERVICE"\n${find?.run}`,
        { SERVICE: service },
        { [command]: standIn },
      );
      expect(result.code, result.stderr).toBe(1);
      expect(result.output).toBe('');
      expect(result.stdout).toBe(UNREAD);
    },
  );

  // The same failure from a real directory: an owned test-results/ that its
  // owner may not read. Root reads it anyway, so the stand-ins above carry
  // the case there.
  test
    .skipIf(process.platform === 'win32' || process.getuid?.() === 0)
    .each(SITES)('%s fails on a test-results/ it may not read', async (job) => {
    const service = await mkdtemp(join(tmpdir(), 'tale-playwright-'));
    roots.push(service);
    const results = join(service, 'test-results');
    await mkdir(join(results, `${FLAKE}-retry1`), { recursive: true });
    await writeFile(join(results, `${FLAKE}-retry1`, 'trace.zip'), 'zip');
    await chmod(results, 0o000);
    try {
      await expect(readdir(results)).rejects.toMatchObject({
        code: 'EACCES',
      });
      const { find } = await pair(job);
      const result = await execute(`set -e\ncd "$SERVICE"\n${find?.run}`, {
        SERVICE: service,
      });
      expect(result.code, result.stderr).toBe(1);
      expect(result.stderr).toContain('Permission denied');
      expect(result.output).toBe('');
      expect(result.stdout).toBe(UNREAD);
    } finally {
      await chmod(results, 0o755);
    }
  });
});

/** Keep runner savings independent of test coverage and build-cache freshness. */
describe('E2E efficiency', () => {
  const e2e = async () =>
    parse(
      await readFile(join(repository, '.github/workflows/e2e.yml'), 'utf8'),
    ) as {
      on: { pull_request: { paths: string[] } };
      jobs: Record<
        string,
        {
          name?: string;
          steps: Step[];
          strategy?: {
            'fail-fast': boolean;
            matrix: { shard: number[] };
          };
        }
      >;
    };

  test('four isolated single-worker shards retain every test partition', async () => {
    const platform = (await e2e()).jobs.e2e!;
    const shards = platform.strategy?.matrix.shard;
    expect(shards).toEqual([1, 2, 3, 4]);
    expect(platform.strategy?.['fail-fast']).toBe(false);
    expect(platform.name).toBe('Playwright (platform ${{ matrix.shard }}/4)');
    const suite = platform.steps.find((step) =>
      step.run?.includes('playwright test'),
    );
    expect(suite?.run).toBe(
      'bunx playwright test --shard=${{ matrix.shard }}/${{ strategy.job-total }}',
    );
    expect(suite?.env?.E2E_WORKERS).toBe('1');
    // No grep/test-file selectors: Playwright partitions the whole discovered
    // suite. The candidate graph suite holds all four names to its receipt.
    expect(suite?.if).toBeUndefined();
    expect(suite?.['continue-on-error']).toBeUndefined();
  });

  test.each(['e2e', 'static-sites'])(
    '%s caches the installed headless browser revision while always installing system dependencies',
    async (job) => {
      const steps = (await e2e()).jobs[job]!.steps;
      const version = steps.find((step) => step.id === 'playwright-version');
      expect(version?.run).toContain(
        'require("@playwright/test/package.json").version',
      );
      const cache = steps.find(
        (step) => step.name === 'Cache Playwright browsers',
      );
      expect(steps.indexOf(version!)).toBeLessThan(steps.indexOf(cache!));
      expect(cache?.with?.key).toBe(
        'playwright-shell-${{ runner.os }}-${{ runner.arch }}-${{ steps.playwright-version.outputs.version }}',
      );
      expect(cache?.with?.['restore-keys']).toBeUndefined();
      const install = steps.find(
        (step) => step.name === 'Install Playwright Chromium',
      );
      expect(install?.run).toContain(
        'bunx playwright install --with-deps --only-shell chromium',
      );
      // Linux shared libraries are runner state, never part of browser cache.
      expect(install?.if).toBeUndefined();
      expect(install?.run).toContain('Acquire::http::Timeout "30"');
      expect(install?.run).toContain('Acquire::Retries "1"');
      for (const service of ['platform', 'web', 'docs']) {
        const config = await readFile(
          join(repository, 'services', service, 'playwright.config.ts'),
          'utf8',
        );
        expect(config).not.toMatch(/\bchannel\s*:/);
        expect(config).not.toMatch(/\bheadless\s*:\s*false/);
      }
    },
  );

  test.skipIf(process.platform === 'win32').each([
    ['installed version', '1.58.2', 0, true],
    ['failed resolver with valid output', '1.58.2', 9, false],
    ['empty version', '', 0, false],
    ['invalid version', 'latest', 0, false],
    ['multiline version', '1.58.2\nother=true', 0, false],
  ])(
    'browser cache identity fails closed for %s',
    async (_, version, code, ok) => {
      const steps = (await e2e()).jobs.e2e!.steps;
      const resolver = steps.find((step) => step.id === 'playwright-version');
      const result = await execute(
        resolver?.run,
        { PROOF_VERSION: String(version), PROOF_EXIT: String(code) },
        {
          bun: '#!/bin/sh\nprintf "%s\\n" "$PROOF_VERSION"\nexit "$PROOF_EXIT"\n',
        },
      );
      if (ok) {
        expect(result.code, result.stderr).toBe(0);
        expect(result.output).toBe(`version=${version}\n`);
      } else {
        expect(result.code).not.toBe(0);
        expect(result.output).toBe('');
      }
    },
  );

  test('the preview build reuses the native build task cache without a second dist cache', async () => {
    const workflow = await e2e();
    const { jobs } = workflow;
    const steps = jobs.build?.steps ?? [];
    const setup = steps.find((step) => step.name === 'Setup toolchain');
    expect(setup?.with?.['cache-scope']).toBe('build');
    expect(setup?.with?.['turbo-cache']).not.toBe('false');
    expect(
      steps.some(
        (step) =>
          step.id === 'dist-cache' || step.name === 'Cache platform dist',
      ),
    ).toBe(false);
    const build = steps.find((step) => step.name?.startsWith('Build platform'));
    expect(build?.run).toBe('bunx turbo run build --filter=@tale/platform');
    expect(build?.if).toBeUndefined();
    for (const input of [
      'packages/shared/src/index.ts',
      'configs/platform/system/harnesses/gemini/harness.yml',
      'docs/en/index.md',
      'patches/postgres.patch',
      'tsconfig.dom.json',
      'bunfig.toml',
    ])
      expect(
        (
          parse(
            await readFile(join(repository, '.github/ci-scope.yml'), 'utf8'),
          ) as Record<string, string[]>
        ).e2e!.some((pattern) => new Bun.Glob(pattern).match(input)),
        input,
      ).toBe(true);
  });
});
