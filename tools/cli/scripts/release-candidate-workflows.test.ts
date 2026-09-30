import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { THIRD_PARTY_IMAGES } from '../src/lib/compose/types';
import { CANDIDATE_JOBS } from './release-candidate-gate';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});
type Step = {
  name?: string;
  run?: string;
  env?: Record<string, string>;
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
  'continue-on-error'?: boolean;
};
type Job = {
  env?: Record<string, string>;
  permissions?: Record<string, string>;
  'timeout-minutes'?: number;
  'continue-on-error'?: boolean;
  name?: string;
  outputs?: Record<string, string>;
  needs?: string | string[];
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
  steps?: Step[];
  strategy?: {
    matrix: {
      include?: Record<string, string>[];
      shard?: number[];
      service?: string[];
    };
  };
};
type Workflow = {
  on: Record<string, unknown>;
  'run-name'?: string;
  concurrency?: { group: string; 'cancel-in-progress': string | boolean };
  jobs: Record<string, Job>;
};
const workflow = async (stem: string) =>
  parse(
    await readFile(join(root, '.github/workflows', `${stem}.yml`), 'utf8'),
  ) as Workflow;
const sourceWorkflows = [
  'checks',
  'sast',
  'commitlint',
  'e2e',
  'cli',
  'security',
];
const C = 'c'.repeat(40);
const H = 'd'.repeat(40);

describe('one candidate event reuses the complete existing validation', () => {
  for (const stem of sourceWorkflows) {
    test(`${stem} accepts the existing event, pins every checkout and keeps candidate concurrency separate`, async () => {
      const file = await workflow(stem);
      expect(file.on.repository_dispatch).toEqual({
        types: ['release-candidate'],
      });
      expect(file['run-name']).toContain("format('Release candidate {0}'");
      expect(file.concurrency?.group).toContain("format('candidate-{0}'");
      expect(file.concurrency?.['cancel-in-progress']).toContain(
        "github.event_name != 'repository_dispatch'",
      );
      expect(file.jobs['candidate-source']?.uses).toBe(
        './.github/workflows/release-candidate-source.yml',
      );
      expect(file.jobs['candidate-source']?.with?.candidate_sha).toBe(
        '${{ github.event.client_payload.candidate_sha }}',
      );
      for (const job of Object.values(file.jobs)) {
        for (const step of job.steps ?? []) {
          if (step.uses?.startsWith('actions/checkout@')) {
            expect(step.with?.ref).toContain(
              'needs.candidate-source.outputs.candidate_sha',
            );
            expect([job.needs].flat()).toContain('candidate-source');
          }
        }
      }
      const receipt = file.jobs['candidate-gate']!;
      expect(receipt.uses).toBe(
        './.github/workflows/release-candidate-receipt.yml',
      );
      expect(receipt.if).toBe(
        "always() && github.event_name == 'repository_dispatch'",
      );
      expect(receipt.with?.workflow).toBe(`.github/workflows/${stem}.yml`);
      const upstream = Object.keys(file.jobs).filter(
        (id) =>
          id !== 'candidate-gate' && !(stem === 'cli' && id === 'release'),
      );
      expect([receipt.needs].flat().toSorted()).toEqual(upstream.toSorted());
      expect([receipt.needs].flat().toSorted()).toEqual(
        CANDIDATE_JOBS[stem]!.ids.toSorted(),
      );
      expect(receipt.with?.jobs).toBe('${{ toJSON(needs) }}');
    });
  }

  test('required receipt job names match every existing matrix leg and reusable job', async () => {
    for (const stem of sourceWorkflows) {
      const file = await workflow(stem);
      const names: string[] = [];
      for (const [id, job] of Object.entries(file.jobs)) {
        if (stem === 'cli' && id === 'release') continue;
        if (job.uses) {
          const called = await workflow(
            job.uses.split('/').at(-1)!.replace('.yml', ''),
          );
          for (const nested of Object.values(called.jobs))
            names.push(`${job.name} / ${nested.name}`);
        } else if (job.strategy) {
          const matrix = job.strategy.matrix;
          const entries =
            matrix.include ??
            matrix.shard?.map((shard) => ({ shard })) ??
            matrix.service!.map((service) => ({ service }));
          for (const entry of entries)
            names.push(
              job.name!.replace(
                /\$\{\{ matrix\.(\w+) \}\}/g,
                (_match, key: string) =>
                  String(entry[key as keyof typeof entry]),
              ),
            );
        } else names.push(job.name!);
      }
      expect(names.toSorted(), stem).toEqual(
        CANDIDATE_JOBS[stem]!.names.toSorted(),
      );
    }
  });

  test('normal events and publication remain separate from candidate validation', async () => {
    for (const stem of sourceWorkflows)
      expect((await workflow(stem)).on.pull_request).toBeDefined();
    for (const stem of ['checks', 'sast', 'commitlint', 'cli', 'security'])
      expect((await workflow(stem)).on.push).toBeDefined();
    for (const stem of ['sast', 'e2e', 'security']) {
      expect((await workflow(stem)).on.schedule).toBeDefined();
      expect(
        Object.hasOwn((await workflow(stem)).on, 'workflow_dispatch'),
      ).toBe(true);
    }
    const cli = await workflow('cli');
    expect(cli.jobs.release?.if).toBe(
      "${{ github.event_name == 'workflow_dispatch' }}",
    );
    expect(
      cli.jobs.build?.steps?.find((step) => step.name === 'Checkout')?.with
        ?.ref,
    ).toBe(
      '${{ needs.candidate-source.outputs.candidate_sha || needs.prepare.outputs.source_sha || github.sha }}',
    );
    expect(cli.jobs.prepare?.outputs?.source_sha).toBe(
      '${{ steps.version.outputs.source_sha }}',
    );
  });

  test('candidate scans remain blocking without uploading SARIF against moving main', async () => {
    for (const stem of ['sast', 'security']) {
      const file = await workflow(stem);
      const uploads = Object.values(file.jobs)
        .flatMap((job) => job.steps ?? [])
        .filter((step) =>
          step.uses?.startsWith('github/codeql-action/upload-sarif@'),
        );
      expect(uploads.length).toBeGreaterThan(0);
      for (const step of uploads)
        expect(step.if).toContain("github.event_name != 'repository_dispatch'");
    }
    const security = await workflow('security');
    expect(
      security.jobs['trivy-fs']?.steps?.find(
        (step) => step.name === 'Trivy vulnerability gate (HIGH/CRITICAL)',
      )?.with?.['exit-code'],
    ).toBe('1');
    expect(
      security.jobs['bun-audit']?.steps?.find(
        (step) => step.name === 'Gate on high/critical advisories',
      )?.run,
    ).toContain('exit 1');
    expect(
      (await workflow('sast')).jobs.sast?.steps?.find(
        (step) => step.name === 'Run Opengrep',
      )?.run,
    ).toContain('bash tools/opengrep/run.sh');
  });
});

test('the Build receipt contract covers its complete existing graph too', async () => {
  const file = await workflow('build');
  expect([file.jobs['candidate-gate']!.needs].flat().toSorted()).toEqual(
    CANDIDATE_JOBS.build!.ids.toSorted(),
  );
});

async function execute(
  script: string,
  environment: Record<string, string>,
  commands: Record<string, string> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'tale-candidate-workflow-'));
  temporary.push(directory);
  const output = join(directory, 'output');
  const summary = join(directory, 'summary');
  await writeFile(output, '');
  await writeFile(summary, '');
  await writeFile(
    join(directory, 'gh'),
    '#!/bin/sh\nprintf "%s\\n" "$COMPARE_STATUS"\n',
    { mode: 0o755 },
  );
  await writeFile(
    join(directory, 'bunx'),
    '#!/bin/sh\nprintf "args=%s\\n" "$*" >> "$GITHUB_OUTPUT"\nif [ "$*" = "commitlint --verbose" ]; then cat >> "$GITHUB_OUTPUT"; fi\n',
    { mode: 0o755 },
  );
  for (const [name, body] of Object.entries(commands)) {
    await writeFile(join(directory, name), body, { mode: 0o755 });
  }
  const process = Bun.spawn(['/bin/bash', '-c', script], {
    cwd: directory,
    env: {
      ...globalThis.process.env,
      PATH: `${directory}:${globalThis.process.env.PATH}`,
      GITHUB_OUTPUT: output,
      GITHUB_ENV: join(directory, 'environment'),
      PROOF_DIR: directory,
      RUNNER_TEMP: directory,
      GITHUB_STEP_SUMMARY: summary,
      ...environment,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return {
    code,
    stdout,
    stderr,
    output: await readFile(output, 'utf8'),
    directory,
  };
}

test.skipIf(process.platform === 'win32')(
  'source helper pins C while normal events keep H; malformed/foreign sources fail before jobs',
  async () => {
    const step = (
      await workflow('release-candidate-source')
    ).jobs.source?.steps?.find((entry) => entry.name === 'Resolve source');
    expect(step?.run).toBeDefined();
    for (const [candidate, sha, status, expected] of [
      ['true', C, 'ahead', 0],
      ['true', C, 'identical', 0],
      ['true', C, 'behind', 1],
      ['true', C, 'diverged', 1],
      ['true', '', 'ahead', 1],
      ['true', 'main', 'ahead', 1],
      ['true', `${C}\n`, 'ahead', 1],
      ['false', '', '', 0],
    ] as const) {
      const result = await execute(step!.run!, {
        IS_CANDIDATE: candidate,
        CANDIDATE_SHA: sha,
        COMPARE_STATUS: status,
        GITHUB_SHA: H,
        REPOSITORY: 'synthetic/tale',
      });
      expect(result.code, result.stdout + result.stderr).toBe(expected);
      expect(result.output).toBe(
        expected
          ? ''
          : `sha=${candidate === 'true' ? C : H}\ncandidate_sha=${candidate === 'true' ? C : ''}\n`,
      );
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'receipt records exact attempt and refuses every failed, skipped, cancelled or missing dependency',
  async () => {
    const step = (
      await workflow('release-candidate-receipt')
    ).jobs.receipt?.steps?.find((entry) => entry.name === 'Record receipt');
    expect(step?.run).toBeDefined();
    for (const result of ['success', 'failure', 'skipped', 'cancelled', '']) {
      const execution = await execute(step!.run!, {
        CANDIDATE_SHA: C,
        WORKFLOW: '.github/workflows/checks.yml',
        WORKFLOW_SHA: H,
        NEEDS: JSON.stringify({
          'candidate-source': { result: 'success' },
          format: { result },
        }),
        RUN_ID: '77',
        RUN_ATTEMPT: '2',
        RUN_URL: 'https://github.com/synthetic/tale/actions/runs/77',
        EVENT_NAME: 'repository_dispatch',
        DISPATCH_REF: 'refs/heads/main',
        DISPATCH_SHA: H,
      });
      expect(execution.code).toBe(result === 'success' ? 0 : 1);
      const receipt = JSON.parse(
        await readFile(
          join(execution.directory, 'release-candidate.json'),
          'utf8',
        ),
      );
      expect(receipt).toMatchObject({
        schemaVersion: 1,
        workflow: '.github/workflows/checks.yml',
        candidate: C,
        verdict: result === 'success' ? 'passed' : 'failed',
        run: { id: '77', attempt: '2', workflowSha: H, sha: H },
        jobs: { format: result },
      });
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'candidate commitlint reads C even when workflow head H and push metadata differ',
  async () => {
    const step = (await workflow('commitlint')).jobs.commitlint?.steps?.find(
      (entry) => entry.name === 'Run commitlint',
    );
    expect(step?.env?.CANDIDATE_SHA).toBe(
      '${{ needs.candidate-source.outputs.candidate_sha }}',
    );
    const setup = `set -euo pipefail
git init -q
git -c user.name='Synthetic test' -c user.email='test@example.invalid' commit -q --allow-empty -m 'fix: candidate source message'
CANDIDATE_SHA=$(git rev-parse HEAD)
git -c user.name='Synthetic test' -c user.email='test@example.invalid' commit -q --allow-empty -m 'chore: unrelated workflow head message'
PUSH_SHA=$(git rev-parse HEAD)
PUSH_BEFORE="$PUSH_SHA"
`;
    const result = await execute(setup + step!.run!, {
      EVENT_NAME: 'repository_dispatch',
    });
    expect(result.code, result.stderr).toBe(0);
    expect(result.output).toBe(
      'args=commitlint --verbose\nfix: candidate source message\n\n',
    );
    expect(result.output).not.toContain('unrelated workflow');
    const missing = await execute(step!.run!, {
      EVENT_NAME: 'repository_dispatch',
      CANDIDATE_SHA: C,
    });
    expect(missing.code).not.toBe(0);
  },
);

test.skipIf(process.platform === 'win32')(
  'commitlint retains normal PR, push and history-less push ranges',
  async () => {
    const step = (await workflow('commitlint')).jobs.commitlint?.steps?.find(
      (entry) => entry.name === 'Run commitlint',
    );
    for (const [event, before, expected] of [
      ['pull_request', '', 'commitlint --from base --to head --verbose'],
      [
        'push',
        'before',
        'commitlint --from before --to workflow-head --verbose',
      ],
      ['push', '', 'commitlint --last --verbose'],
      ['push', '0'.repeat(40), 'commitlint --last --verbose'],
    ]) {
      const result = await execute(step!.run!, {
        EVENT_NAME: event!,
        PUSH_BEFORE: before!,
        PUSH_SHA: 'workflow-head',
        PR_BASE: 'base',
        PR_HEAD: 'head',
      });
      expect(result.code, result.stderr).toBe(0);
      expect(result.output).toBe(`args=${expected}\n`);
    }
  },
);

test.skipIf(process.platform === 'win32').each(['lightweight', 'annotated'])(
  'CLI tag publication binds the exact %s tag to the workflow commit before building',
  async (kind) => {
    const step = (await workflow('cli')).jobs.prepare?.steps?.find(
      (entry) => entry.name === 'Resolve version',
    );
    const setup = `set -euo pipefail
git init -q
git -c user.name='Synthetic test' -c user.email='test@example.invalid' commit -q --allow-empty -m 'fix: release source'
GITHUB_SHA=$(git rev-parse HEAD)
printf '%s' "$GITHUB_SHA" > expected-source
${kind === 'annotated' ? "git -c user.name='Synthetic test' -c user.email='test@example.invalid' tag -a v0.5.64 -m release" : 'git tag v0.5.64'}
git -c user.name='Synthetic test' -c user.email='test@example.invalid' commit -q --allow-empty -m 'fix: different source'
git tag v0.5.65
cat > gh <<'GH'
#!/bin/sh
[ "$1" = api ] && [ "$2" = 'repos/synthetic/tale/commits/refs%2Ftags%2Fv0.5.64' ] && [ "$3" = --jq ] && [ "$4" = .sha ] || exit 1
git rev-parse 'refs/tags/v0.5.64^{commit}'
GH
chmod +x gh
`;
    for (const [ref, tag, suffix, expected] of [
      ['refs/tags/v0.5.64', 'v0.5.64', '', 0],
      ['refs/tags/v0.5.64', 'v0.5.65', '', 1],
      ['refs/tags/v0.5.64', 'v0.5.64', 'GITHUB_SHA=$(git rev-parse HEAD)\n', 1],
      ['refs/heads/main', 'v0.5.64', '', 0],
      ['refs/heads/manual-recovery', 'v0.5.64', '', 0],
    ] as const) {
      const result = await execute(
        setup +
          suffix +
          step!.run! +
          (expected === 0
            ? `
publication_source=$(sed -n 's/^source_sha=//p' "$GITHUB_OUTPUT")
# Only this test's synthetic repository changes; the prepared source stays C.
git tag -f v0.5.64 HEAD > /dev/null
git checkout -q --detach "$publication_source"
[ "$(git rev-parse HEAD)" = "$(cat expected-source)" ]
`
            : ''),
        {
          EVENT_NAME: 'workflow_dispatch',
          RELEASE_TAG: tag,
          GITHUB_REF: ref,
          REPOSITORY: 'synthetic/tale',
        },
      );
      expect(result.code, `${ref}/${tag}: ${result.stderr}`).toBe(expected);
      const source = await readFile(
        join(result.directory, 'expected-source'),
        'utf8',
      );
      expect(result.output).toBe(
        expected ? '' : `version=0.5.64\nsource_sha=${source}\n`,
      );
    }
  },
);

describe('the real backend proof is a required uncached candidate job', () => {
  test('all events run every lane with shipped services and retain the failure evidence', async () => {
    const file = await workflow('checks');
    const job = file.jobs['backend-integration'];
    expect(job).toBeDefined();
    expect(job.if).toBeUndefined();
    expect(job['continue-on-error']).toBeUndefined();
    expect(job.permissions).toEqual({ contents: 'read' });
    expect(job['timeout-minutes']).toBeGreaterThan(0);
    expect(job['timeout-minutes']).toBeLessThanOrEqual(60);
    expect(job.env?.ITEST_REQUIRE_ALL_LANES).toBe('1');
    expect(JSON.stringify(job)).not.toContain('ITEST_LANES');
    expect(job.env?.ITEST_S3_ENDPOINT).toBe('http://127.0.0.1:19000');
    expect(job.env?.VIDEO_INGEST_FFMPEG_LOCATION).toBe('/usr/bin/ffmpeg');
    expect(
      job.steps!.find((step) => step.name === 'Setup toolchain')?.with?.[
        'start-turbo-cache'
      ],
    ).toBe('false');
    const prepare = job.steps!.find(
      (step) => step.name === 'Prepare isolated proof and shipped runtime pins',
    )!;
    expect(prepare.run).toContain('THIRD_PARTY_IMAGES["object-store"]');
    for (const variable of [
      'DATABASE_URL',
      'KNOWLEDGE_DATABASE_URL',
      'ITEST_S3_ACCESS_KEY',
      'ITEST_S3_SECRET_KEY',
      'TALE_CONFIG_DIR',
      'TALE_CONFIG_BUILTIN_DIR',
    ]) {
      expect(prepare.run).toContain(`echo "${variable}=`);
    }
    const build = job.steps!.find(
      (step) => step.name === 'Build candidate database image',
    )!;
    expect(build.run).toContain('docker build --file services/db/Dockerfile');
    const services = job.steps!.find(
      (step) =>
        step.name === 'Start disposable database and shipped object store',
    )!;
    expect(services.run).toContain('--env TALE_DB_ROLE=knowledge');
    expect(services.run).toContain('.State.Health.Status');
    expect(services.run).toContain("extname IN ('pg_search', 'vector')");
    const run = job.steps!.find(
      (step) => step.name === 'Run every backend integration lane',
    )!;
    expect(run.if).toBeUndefined();
    expect(run['continue-on-error']).toBeUndefined();
    expect(run.run).toContain(
      'bun run --filter @tale/platform backend:integration',
    );
    expect(run.run).not.toMatch(/bunx? (?:run )?turbo/);
    const evidence = job.steps!.find(
      (step) => step.name === 'Upload backend integration evidence',
    )!;
    expect(evidence.if).toBe('always()');
    expect(evidence.with?.['if-no-files-found']).toBe('error');
    expect(evidence.with?.path).not.toMatch(/config|builtin/);
    for (const step of job.steps ?? []) {
      if (step.uses && !step.uses.startsWith('./')) {
        expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      }
    }
  });

  test.skipIf(process.platform === 'win32')(
    'preparation resolves the shipped pins and isolates every writable input',
    async () => {
      const job = (await workflow('checks')).jobs['backend-integration'];
      const step = job.steps!.find(
        (entry) =>
          entry.name === 'Prepare isolated proof and shipped runtime pins',
      )!;
      const result = await execute(`cd "$CHECKOUT"\n${step.run}`, {
        CHECKOUT: root,
        GITHUB_RUN_ID: '77',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_EVENT_NAME: 'repository_dispatch',
        GITHUB_SHA: H,
      });
      expect(result.code, result.stderr).toBe(0);
      const dockerfile = await readFile(
        join(root, 'services/platform/Dockerfile'),
        'utf8',
      );
      const shippingNode = dockerfile.match(
        /^FROM node:(\d+\.\d+\.\d+)-[^ ]+ AS node-bin$/m,
      )?.[1];
      expect(shippingNode).toBeDefined();
      expect(result.output).toBe(`node-version=${shippingNode}\n`);
      const environment = await readFile(
        join(result.directory, 'environment'),
        'utf8',
      );
      expect(environment).toContain(
        `OBJECT_STORE_IMAGE=${THIRD_PARTY_IMAGES['object-store']}\n`,
      );
      const proof = join(result.directory, 'backend-integration-77-2');
      for (const [name, suffix] of [
        ['TALE_CONFIG_DIR', 'config'],
        ['TALE_CONFIG_BUILTIN_DIR', 'builtin'],
      ]) {
        expect(environment).toContain(`${name}=${join(proof, suffix)}\n`);
      }
      expect(environment).toMatch(/ITEST_S3_SECRET_KEY=[a-f0-9]{48}\n/);
      expect(environment).toMatch(
        /DATABASE_URL=postgresql:\/\/tale:[a-f0-9]{48}@127\.0\.0\.1:15432\/tale_app\n/,
      );
      expect(await readFile(join(proof, 'source.txt'), 'utf8')).toContain(
        `workflow-sha=${H}\n`,
      );
    },
  );

  test.skipIf(process.platform === 'win32')(
    'a failing lane stays red through tee and leaves its raw output',
    async () => {
      const job = (await workflow('checks')).jobs['backend-integration'];
      const step = job.steps!.find(
        (entry) => entry.name === 'Run every backend integration lane',
      )!;
      for (const code of [0, 1, 2]) {
        const result = await execute(
          step.run!,
          {
            ITEST_REQUIRE_ALL_LANES: job.env!.ITEST_REQUIRE_ALL_LANES,
            LANE_EXIT: String(code),
          },
          {
            bun: `#!/bin/sh
[ "$*" = "run --filter @tale/platform backend:integration" ] || exit 99
[ "$ITEST_REQUIRE_ALL_LANES" = 1 ] || exit 98
printf 'synthetic lane: exit %s\n' "$LANE_EXIT"
exit "$LANE_EXIT"
`,
          },
        );
        expect(result.code, result.stderr).toBe(code);
        expect(
          await readFile(join(result.directory, 'exit-code.txt'), 'utf8'),
        ).toBe(`${code}\n`);
        expect(
          await readFile(
            join(result.directory, 'backend-integration.log'),
            'utf8',
          ),
        ).toBe(`synthetic lane: exit ${code}\n`);
      }
    },
  );
});
