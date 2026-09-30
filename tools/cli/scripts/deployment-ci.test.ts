import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
) {
  if (!script) throw new Error('Deployment CI script is missing');
  const root = await mkdtemp(join(tmpdir(), 'tale-deployment-ci-'));
  roots.push(root);
  const output = join(root, 'output');
  await writeFile(output, '');
  // macOS still ships Bash 3.2. Its errexit behavior differs for a bare
  // failed [[ condition ]], so exercise that supported shell explicitly.
  const shell = process.platform === 'darwin' ? '/bin/bash' : 'bash';
  const child = Bun.spawn([shell, '-c', script], {
    cwd: root,
    env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...environment },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr, output: await readFile(output, 'utf8') };
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
    // A push or pull request keeps `Build-<ref>` and cancels what it
    // supersedes; either dispatch of one SHA shares `Build-candidate-<sha>`,
    // which only another dispatch of that SHA can enter, and cancels nothing.
    expect(build.concurrency).toEqual({
      group: `\${{ github.workflow }}-\${{ ${dispatched} && format('candidate-{0}', ${candidate}) || github.ref }}`,
      'cancel-in-progress':
        "${{ github.event_name != 'workflow_dispatch' && github.event_name != 'repository_dispatch' }}",
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
        parse(String(step(changes, 'Filter paths').with?.filters)) as Record<
          string,
          unknown
        >,
      );
      expect(step(changes, 'Filter paths').if).toBe(
        "needs.candidate-source.outputs.candidate_sha == ''",
      );
      const matrix = step(changes, 'Compute service matrix').run;
      const candidate = outputs(
        (
          await execute(matrix, {
            CANDIDATE_SHA: CANDIDATE,
            CHANGES: '',
            CI_TESTS: '',
            STORYBOOK: '',
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
        CHANGES: '["platform","web","ci_tests"]',
        CI_TESTS: 'true',
        STORYBOOK: 'false',
      });
      expect(pushed.code, pushed.stdout + pushed.stderr).toBe(0);
      expect(outputs(pushed.output)).toEqual({
        list: '["platform","web"]',
        scannable: '["platform"]',
        ci_tests: 'true',
        storybook: 'false',
      });
    },
  );

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
      if (id === 'changes') {
        expect(entry.with?.ref).toBe(
          '${{ needs.candidate-source.outputs.candidate_sha }}',
        );
        expect(changes.needs).toBe('candidate-source');
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
      expect(record.if).toBe("steps.pushmode.outputs.push == 'true'");
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
        SOURCE_SHA: '${{ needs.changes.outputs.source_sha }}',
        RECEIPTS: '${{ runner.temp }}/image-receipts',
      });
      return async (
        directory: string,
        foreign: { service?: string; revision?: string } = {},
      ) => {
        const tools = await standIns();
        const result = await execute(expand(pulling.run), {
          PATH: tools.path,
          TEST_COMMAND_LOG: tools.log,
          TEST_REVISION: CANDIDATE,
          TEST_FOREIGN_SERVICE: foreign.service ?? '-',
          TEST_FOREIGN_REVISION: foreign.revision ?? '',
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
        expect(result.calls).toEqual([
          ...BUILT.flatMap((service) => [
            `docker pull ${image(service)}`,
            `docker image inspect --format {{ index .Config.Labels "org.opencontainers.image.revision" }} ${image(service)}`,
            `docker tag ${image(service)} ghcr.io/tale-project/tale/tale-${service}:latest`,
          ]),
          'docker tag ghcr.io/tale-project/tale/tale-sandbox-runtime:latest tale-sandbox-runtime:latest',
        ]);
        // The loop pulls exactly what the build matrix builds.
        expect(BUILT.toSorted()).toEqual(
          (await workflow()).jobs.build!.strategy!.matrix!.service!.toSorted(),
        );
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
        expect(missing.calls.some((call) => call.includes('tale-proxy'))).toBe(
          false,
        );
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

  test.skipIf(process.platform === 'win32')(
    'is owed by every push, merge group and candidate, and by a pull request that touches what the suite runs',
    async () => {
      const script = (await checks()).jobs['integration-scope']?.steps.find(
        (step) => step.id === 'decide',
      )?.run;
      for (const [event, touched, owed] of [
        ['pull_request', 'true', 'true'],
        ['pull_request', 'false', 'false'],
        ['pull_request', '', 'false'],
        ['push', '', 'true'],
        ['merge_group', '', 'true'],
        ['repository_dispatch', '', 'true'],
      ] as const) {
        const result = await execute(script, {
          EVENT_NAME: event,
          TOUCHED: touched,
        });
        expect(result.code, `${event}/${touched}`).toBe(0);
        expect(result.output, `${event}/${touched}`).toBe(`run=${owed}\n`);
      }
    },
  );

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
    expect(
      steps.find((step) => step.uses?.startsWith('docker/build-push-action@'))
        ?.with,
    ).toMatchObject({ file: 'services/db/Dockerfile', push: false });
    expect(job?.['timeout-minutes']).toBeGreaterThan(0);
    expect(job?.if).toContain("needs.integration-scope.outputs.run == 'true'");
  });
});
