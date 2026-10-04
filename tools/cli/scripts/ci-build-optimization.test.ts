import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parse } from 'yaml';

type Step = {
  name?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Workflow = {
  on: Record<string, { paths?: string[] }>;
  jobs: Record<
    string,
    {
      if?: string;
      needs?: string[];
      strategy?: {
        'max-parallel'?: number;
        matrix?: { include?: { os: string; cross?: boolean }[] };
      };
      steps: Step[];
    }
  >;
};

const repository = resolve(import.meta.dir, '../../..');
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function workflow(name: string): Promise<Workflow> {
  return parse(
    await readFile(join(repository, `.github/workflows/${name}.yml`), 'utf8'),
  ) as Workflow;
}

function step(file: Workflow, job: string, name: string): Step {
  const found = file.jobs[job]?.steps.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing ${job}/${name}`);
  return found;
}

async function execute(
  script: string,
  env: Record<string, string>,
  cwd?: string,
) {
  const directory = await mkdtemp(join(tmpdir(), 'tale-build-ci-'));
  directories.push(directory);
  const output = join(directory, 'output');
  await writeFile(output, '');
  const child = Bun.spawn(['bash', '-euo', 'pipefail', '-c', script], {
    cwd: cwd ?? directory,
    env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return {
    code,
    stdout,
    stderr,
    outputs: Object.fromEntries(
      (await readFile(output, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => [
          line.slice(0, line.indexOf('=')),
          line.slice(line.indexOf('=') + 1),
        ]),
    ),
  };
}

test.skipIf(process.platform === 'win32')(
  'standalone site changes avoid the platform stack while shared build inputs retain full coverage',
  async () => {
    const file = await workflow('build');
    const filters = parse(
      String(step(file, 'changes', 'Filter paths').with?.filters),
    ) as Record<string, string[]>;
    const cases: [string, string[], boolean][] = [
      ['docs/en/index.md', ['docs'], false],
      ['services/web/app/index.tsx', ['web'], false],
      ['compose.ui-docs.test.yml', ['ui-docs'], false],
      ['services/platform/backend/server.ts', ['platform'], true],
      ['services/sandbox-runtime/Dockerfile', ['sandbox-runtime'], true],
      [
        'configs/platform/system/harnesses/gemini/harness.yml',
        ['platform', 'sandbox-runtime'],
        true,
      ],
      [
        'configs/platform/custom/skills/visual-aspect-analyzer/SKILL.md',
        ['platform', 'sandbox-runtime'],
        true,
      ],
      ['configs/platform/custom/agents/example.yml', ['platform'], true],
      ['compose.yml', [], true],
      ['bun.lock', ['platform', 'web', 'docs', 'ui-docs', 'ai-gateway'], true],
      [
        'package.json',
        ['platform', 'web', 'docs', 'ui-docs', 'ai-gateway'],
        true,
      ],
      [
        'tools/cli/package.json',
        ['platform', 'web', 'docs', 'ui-docs', 'ai-gateway'],
        true,
      ],
      [
        'packages/shared/src/index.ts',
        ['platform', 'web', 'docs', 'ui-docs', 'ai-gateway'],
        true,
      ],
      [
        'patches/postgres.patch',
        ['platform', 'web', 'docs', 'ui-docs', 'ai-gateway'],
        true,
      ],
      [
        'tsconfig.dom.json',
        ['platform', 'web', 'docs', 'ui-docs', 'ai-gateway'],
        true,
      ],
      [
        '.github/workflows/build.yml',
        ['platform', 'web', 'docs', 'ui-docs', 'ai-gateway'],
        true,
      ],
    ];
    for (const [path, services, stack] of cases) {
      for (const event of ['push', 'pull_request'])
        expect(
          file.on[event]?.paths?.some((pattern) =>
            new Bun.Glob(pattern).match(path),
          ),
          `${event}: ${path}`,
        ).toBe(true);
      const changes = Object.keys(filters).filter((key) =>
        filters[key]!.some((pattern) => new Bun.Glob(pattern).match(path)),
      );
      const result = await execute(
        step(file, 'changes', 'Compute service matrix').run!,
        {
          CANDIDATE_SHA: '',
          CHANGES: JSON.stringify(changes),
          CI_TESTS: String(changes.includes('ci_tests')),
          STORYBOOK: String(changes.includes('storybook')),
        },
      );
      expect(result.code, result.stdout + result.stderr).toBe(0);
      expect(result.outputs.ci_tests, path).toBe(String(stack));
      const selected = JSON.parse(result.outputs.list!) as string[];
      expect(selected, path).toEqual(expect.arrayContaining(services));
      if (!stack) expect(selected).toEqual(services);
      expect(selected).not.toContain('shared_build');
    }
    for (const job of [
      'build',
      'smoke-test',
      'image-validate',
      'smoke-test-fork',
      'image-validate-fork',
    ]) {
      expect(file.jobs[job]?.if).toContain(
        "needs.changes.outputs.ci_tests == 'true'",
      );
      expect(file.jobs[job]?.if).not.toContain("outputs.services != '[]'");
    }
  },
);

test.each(['web', 'docs', 'ui-docs', 'ai-gateway'])(
  '%s probes the locally loaded cached image with no implicit pull or rebuild',
  async (service) => {
    const file = await workflow('build');
    const job = `${service}-test`;
    const build = step(file, job, 'Build site image');
    expect(build.with).toMatchObject({
      source: '.',
      files: '${{ runner.temp }}/site-build.json',
      targets: service,
      load: true,
    });
    expect(build.with?.set).toContain(`*.cache-from=type=gha,scope=${service}`);
    expect(build.with?.set).toContain(
      `*.cache-to=type=gha,scope=${service},mode=max`,
    );
    const plan = step(file, job, 'Resolve site build');
    expect(plan.env).toEqual({ SERVICE: service });
    expect(plan.run).toContain('build --print "$SERVICE"');
    expect(file.jobs[job]!.steps.indexOf(plan)).toBeLessThan(
      file.jobs[job]!.steps.indexOf(build),
    );
    const probes = step(file, job, `Run ${service} container test`);
    expect(probes.env).toEqual({ SKIP_BUILD: 'true', PULL_POLICY: 'never' });
    expect(file.jobs[job]!.steps.indexOf(build)).toBeLessThan(
      file.jobs[job]!.steps.indexOf(probes),
    );
  },
);

test.skipIf(process.platform === 'win32' || !Bun.which('docker'))(
  'cached site plans preserve Compose overrides, environment interpolation and image identity',
  async () => {
    const file = await workflow('build');
    const directory = await mkdtemp(join(tmpdir(), 'tale-site-build-'));
    directories.push(directory);
    await mkdir(join(directory, 'services/web'), { recursive: true });
    await writeFile(
      join(directory, '.env.test'),
      'SITE_TITLE=changed-in-env\n',
    );
    await writeFile(
      join(directory, 'compose.web.yml'),
      JSON.stringify({
        services: {
          web: {
            image: 'example/site:compose-tag',
            build: {
              context: '.',
              dockerfile: 'Custom.Dockerfile',
              target: 'custom-stage',
              args: { SITE_TITLE: '${SITE_TITLE:-default}' },
            },
            env_file: ['services/web/.env'],
          },
        },
      }),
    );
    await writeFile(
      join(directory, 'compose.web.test.yml'),
      JSON.stringify({
        services: {
          web: { build: { args: { TEST_OVERRIDE: 'from-compose-test' } } },
        },
      }),
    );
    const result = await execute(
      step(file, 'web-test', 'Resolve site build').run!,
      {
        SERVICE: 'web',
        RUNNER_TEMP: directory,
      },
      directory,
    );
    expect(result.code, result.stdout + result.stderr).toBe(0);
    const plan = JSON.parse(
      await readFile(join(directory, 'site-build.json'), 'utf8'),
    );
    expect(plan.target.web).toMatchObject({
      args: {
        SITE_TITLE: 'changed-in-env',
        TEST_OVERRIDE: 'from-compose-test',
      },
      tags: ['example/site:compose-tag'],
      target: 'custom-stage',
    });
    expect(plan.target.web.dockerfile).toEndWith('Custom.Dockerfile');
  },
);

test.skipIf(process.platform === 'win32')(
  'release schedules expensive images first, reuses architecture caches and preserves all gates',
  async () => {
    const file = await workflow('release');
    const prepare = step(file, 'prepare', 'Resolve version').run!;
    for (const sites of ['false', 'true']) {
      const result = await execute(prepare, {
        EVENT_NAME: 'workflow_dispatch',
        INPUT_VERSION: 'v1.2.3',
        SITES_ONLY: sites,
      });
      expect(result.code, result.stderr).toBe(0);
      const services = JSON.parse(result.outputs.service_names!) as string[];
      if (sites === 'true')
        expect(services).toEqual(['web', 'docs', 'ui-docs']);
      else {
        expect(services.slice(0, 2)).toEqual(['sandbox-runtime', 'platform']);
        expect(new Set(services).size).toBe(12);
      }
    }
    expect(file.jobs.build?.strategy?.['max-parallel']).toBe(6);
    expect(
      step(file, 'build', 'Build and push').with?.['cache-from'],
    ).toContain('type=gha,scope=${{ matrix.service.name }}');
    expect(step(file, 'build', 'Build and push').with?.['cache-to']).toContain(
      ':buildcache-${{ matrix.arch.name }},mode=max',
    );
    expect(file.jobs.manifest?.needs).toEqual(
      expect.arrayContaining(['prepare', 'build', 'container-test']),
    );
  },
);

test('CLI source tests still cover every host OS while every target builds', async () => {
  const file = await workflow('cli');
  const matrix = file.jobs.build?.strategy?.matrix?.include ?? [];
  expect(
    new Set(matrix.filter((entry) => !entry.cross).map((entry) => entry.os)),
  ).toEqual(new Set(matrix.map((entry) => entry.os)));
  expect(step(file, 'build', 'Run unit tests').if).toBe('${{ !matrix.cross }}');
  expect(step(file, 'build', 'Build binary').if).toBeUndefined();
  expect(step(file, 'build', 'Upload artifact').with).toMatchObject({
    'compression-level': 1,
    'if-no-files-found': 'error',
  });
});

test.skipIf(process.platform === 'win32')(
  'parallel image pulls stay bounded and never hide an early failed child',
  async () => {
    const services = [
      'db',
      'platform',
      'proxy',
      'sandbox-llm-gateway',
      'sandbox',
      'sandbox-egress',
      'sandbox-buildkitd',
      'sandbox-runtime',
    ];
    const source = 'a'.repeat(40);
    const digest = `sha256:${'b'.repeat(64)}`;
    const build = await workflow('build');
    const release = await workflow('release');
    const scripts = [
      step(build, 'smoke-test', 'Pull images from GHCR').run!,
      step(build, 'image-validate', 'Pull images from GHCR').run!,
      step(release, 'container-test', 'Pull release images').run!,
    ];
    for (const script of scripts) {
      for (const fails of [false, true]) {
        const directory = await mkdtemp(join(tmpdir(), 'tale-pull-ci-'));
        directories.push(directory);
        const receipts = join(directory, 'receipts');
        const log = join(directory, 'calls');
        await mkdir(receipts);
        await writeFile(log, '');
        for (const service of services)
          await writeFile(
            join(receipts, `${service}.json`),
            JSON.stringify({ digest }),
          );
        await writeFile(
          join(directory, 'docker'),
          `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  pull)
    echo "start $2" >> "$TEST_CALLS"
    sleep 0.1
    echo "end $2" >> "$TEST_CALLS"
    if [ "$TEST_FAILS" = true ] && [[ "$2" == */tale-db[@:]* ]]; then exit 7; fi
    ;;
  image)
    echo "$SOURCE_SHA"
    ;;
  tag)
    echo "tag $2 $3" >> "$TEST_CALLS"
    ;;
  *) exit 9 ;;
esac
`,
          { mode: 0o755 },
        );
        const expanded = script
          .replaceAll('${{ env.REGISTRY }}', 'ghcr.io')
          .replaceAll('${{ github.repository }}', 'tale-project/tale')
          .replaceAll('${{ needs.prepare.outputs.version_number }}', '1.2.3');
        const result = await execute(expanded, {
          PATH: `${directory}:${process.env.PATH}`,
          SOURCE_SHA: source,
          RECEIPTS: receipts,
          SERVICE_NAMES: JSON.stringify(services),
          TEST_CALLS: log,
          TEST_FAILS: String(fails),
        });
        const calls = (await readFile(log, 'utf8')).trim().split('\n');
        let active = 0;
        let peak = 0;
        for (const call of calls) {
          if (call.startsWith('start ')) active++;
          if (call.startsWith('end ')) active--;
          peak = Math.max(peak, active);
          expect(active).toBeGreaterThanOrEqual(0);
        }
        expect(active).toBe(0);
        expect(peak).toBeLessThanOrEqual(3);
        if (fails) {
          expect(result.code).not.toBe(0);
          expect(
            calls.filter((call) => call.startsWith('start ')),
          ).toHaveLength(3);
          expect(
            calls.some((call) =>
              call.startsWith('tag ghcr.io/tale-project/tale/tale-db'),
            ),
          ).toBe(false);
          expect(
            calls.some((call) => call.endsWith(' tale-sandbox-runtime:latest')),
          ).toBe(false);
        } else {
          expect(result.code, result.stdout + result.stderr).toBe(0);
          expect(
            calls.filter((call) => call.startsWith('start ')),
          ).toHaveLength(services.length);
          expect(
            calls.some((call) => call.endsWith(' tale-sandbox-runtime:latest')),
          ).toBe(true);
        }
      }
    }
  },
);
