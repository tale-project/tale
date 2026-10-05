import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import picomatch from 'picomatch';
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
      permissions?: Record<string, string>;
      needs?: string[];
      strategy?: {
        'max-parallel'?: number;
        matrix?: {
          service?: string[];
          include?: { os: string; cross?: boolean }[];
        };
      };
      steps: Step[];
    }
  >;
};

const repository = resolve(import.meta.dir, '../../..');
const source = '1234567890abcdef1234567890abcdef12345678';
const matches = (patterns: string[], path: string) =>
  patterns.some((pattern) => picomatch(pattern, { dot: true })(path));
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function workflow(name = 'build'): Promise<Workflow> {
  return parse(
    await readFile(join(repository, `.github/workflows/${name}.yml`), 'utf8'),
  ) as Workflow;
}

function findStep(job: Workflow['jobs'][string], name: string): Step {
  const found = job.steps.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing ${name}`);
  return found;
}

function step(file: Workflow, job: string, name: string): Step {
  const found = file.jobs[job];
  if (!found) throw new Error(`Missing ${job}`);
  return findStep(found, name);
}

const outputs = (text: string) =>
  Object.fromEntries(
    text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );

async function execute(
  script: string,
  env: Record<string, string> = {},
  cwd?: string,
) {
  const directory = await mkdtemp(join(tmpdir(), 'tale-build-ci-'));
  directories.push(directory);
  const output = join(directory, 'output');
  await writeFile(output, '');
  const shell = process.platform === 'darwin' ? '/bin/bash' : 'bash';
  const child = Bun.spawn([shell, '-euo', 'pipefail', '-c', script], {
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
    output: await readFile(output, 'utf8'),
    outputs: outputs(await readFile(output, 'utf8')),
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
      [
        'services/platform/tests/integration/container-docs-test.ts',
        ['docs'],
        false,
      ],
      [
        'services/platform/lib/harnesses/gemini.ts',
        ['platform', 'sandbox-runtime'],
        true,
      ],
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
      [
        'packages/ui/src/button.tsx',
        ['platform', 'web', 'docs', 'ui-docs', 'ai-gateway'],
        true,
      ],
      ['.github/scripts/pull-ci-images.sh', [], true],
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
        matches(filters[key]!, path),
      );
      const result = await execute(
        step(file, 'changes', 'Compute service matrix').run!,
        {
          CANDIDATE_SHA: '',
          CHANGES: JSON.stringify(changes),
          CI_TESTS: String(changes.includes('ci_tests')),
          STORYBOOK: String(changes.includes('storybook')),
          IMAGE_INPUTS: String(changes.includes('image_inputs')),
        },
      );
      expect(result.code, result.stdout + result.stderr).toBe(0);
      expect(result.outputs.stack, path).toBe(String(stack));
      const selected = JSON.parse(result.outputs.list!) as string[];
      expect(selected, path).toEqual(expect.arrayContaining(services));
      if (!stack) expect(selected).toEqual(services);
      expect(selected).not.toContain('shared_build');
      expect(selected).not.toContain('image_inputs');
    }
    for (const job of [
      'build',
      'smoke-test',
      'image-validate',
      'smoke-test-fork',
      'image-validate-fork',
    ]) {
      expect(file.jobs[job]?.if).toContain(
        "needs.changes.outputs.stack == 'true'",
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
    expect(file.jobs[job]!.permissions).toEqual({
      actions: 'read',
      contents: 'read',
    });
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
    expect(build.with?.set).toContain(
      'ghtoken=${{ secrets.GITHUB_TOKEN }},repository=${{ github.repository }}',
    );
    expect(build.with?.set).not.toContain(
      `*.cache-from=type=gha,scope=${service},ghtoken=`,
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
    ).toContain("matrix.arch.name == 'amd64'");
    expect(
      step(file, 'build', 'Build and push').with?.['cache-from'],
    ).toContain("format('type=gha,scope={0}', matrix.service.name)");
    expect(step(file, 'build', 'Build and push').with?.['cache-to']).toContain(
      '-buildcache:${{ matrix.arch.name }},mode=max,ignore-error=true',
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

test('cross CLI builds isolate filtered dependencies while native suites keep the shared cache', async () => {
  const file = await workflow('cli');
  const configure = step(file, 'build', 'Configure Bun install cache');
  const cache = step(file, 'build', 'Restore Bun install cache');
  const install = step(file, 'build', 'Install dependencies');
  expect(configure.if).toBe('matrix.cross');
  expect(configure.run).toContain(
    'BUN_INSTALL_CACHE_DIR=${RUNNER_TEMP}/bun-cli-cache',
  );
  expect(cache.with?.path).toBe(
    "${{ matrix.cross && env.BUN_INSTALL_CACHE_DIR || '~/.bun/install/cache' }}",
  );
  expect(cache.with?.key).toBe(
    "${{ matrix.cross && 'bun-cli-install' || 'bun-install' }}-${{ runner.os }}-${{ runner.arch }}-1.4.2-${{ hashFiles('bun.lock') }}",
  );
  expect(String(cache.with?.['restore-keys']).trim()).toBe(
    "${{ matrix.cross && 'bun-cli-install' || 'bun-install' }}-${{ runner.os }}-${{ runner.arch }}-1.4.2-",
  );
  expect(install.env?.CROSS).toBe('${{ matrix.cross }}');
  const names = file.jobs.build!.steps.map((entry) => entry.name);
  expect(names.indexOf(configure.name)).toBeLessThan(names.indexOf(cache.name));
  expect(names.indexOf(install.name)).toBeLessThan(
    names.indexOf('Generate embedded files'),
  );
});

test.skipIf(process.platform === 'win32')(
  'CLI install filters only cross builds and remains frozen on every host',
  async () => {
    const install = step(
      await workflow('cli'),
      'build',
      'Install dependencies',
    );
    const directory = await mkdtemp(join(tmpdir(), 'tale-cli-install-ci-'));
    directories.push(directory);
    await writeFile(
      join(directory, 'bun'),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$@"\n',
      { mode: 0o755 },
    );
    for (const cross of ['true', 'false', '']) {
      const result = await execute(install.run!, {
        PATH: `${directory}:${process.env.PATH}`,
        CROSS: cross,
      });
      expect(result.code, result.stdout + result.stderr).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual(
        cross === 'true'
          ? ['install', '--frozen-lockfile', '--filter', '@tale/cli']
          : ['install', '--frozen-lockfile'],
      );
    }
  },
);

test('hosted release builders skip teardown after publishing their images and caches', async () => {
  expect(
    step(await workflow('release'), 'build', 'Setup Docker builder').with
      ?.cleanup,
  ).toBe(false);
});

describe.skipIf(process.platform === 'win32')(
  'parallel verified release image pulls',
  () => {
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
    // Exercise Release's real three- and twelve-image selections under
    // macOS Bash 3.2 as well as the eight-image stack.
    const cases: [string, string, string, string, string[]][] = [
      [
        'Release stack (8)',
        'release',
        'container-test',
        'Pull release images',
        services,
      ],
      [
        'Release sites (3)',
        'release',
        'container-test',
        'Pull release images',
        ['web', 'docs', 'ui-docs'],
      ],
      [
        'Release full (12)',
        'release',
        'container-test',
        'Pull release images',
        [
          'sandbox-runtime',
          'platform',
          'db',
          'web',
          'docs',
          'ui-docs',
          'ai-gateway',
          'proxy',
          'sandbox-llm-gateway',
          'sandbox',
          'sandbox-egress',
          'sandbox-buildkitd',
        ],
      ],
    ];
    test.each(cases)(
      '%s stays bounded and never hides an early failed child',
      async (_label, name, job, pullStep, selectedServices) => {
        const pullSource = 'a'.repeat(40);
        const digest = `sha256:${'b'.repeat(64)}`;
        const script = step(await workflow(name), job, pullStep).run!;
        for (const failureStage of ['', 'pull', 'tag']) {
          const fails = failureStage !== '';
          const directory = await mkdtemp(join(tmpdir(), 'tale-pull-ci-'));
          directories.push(directory);
          const receipts = join(directory, 'receipts');
          const log = join(directory, 'calls');
          await mkdir(receipts);
          await writeFile(log, '');
          for (const service of selectedServices)
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
    if [ "$TEST_FAIL_STAGE" = pull ] && [[ "$2" == */tale-"$TEST_FAIL_SERVICE"[@:]* ]]; then exit 7; fi
    ;;
  image)
    echo "$SOURCE_SHA"
    ;;
  tag)
    echo "tag $2 $3" >> "$TEST_CALLS"
    if [ "$TEST_FAIL_STAGE" = tag ] && [[ "$2" == */tale-"$TEST_FAIL_SERVICE"[@:]* ]]; then exit 8; fi
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
          const result = await execute(
            expanded,
            {
              REGISTRY_PATH: 'ghcr.io/tale-project/tale',
              PULL_HELPER: join(
                repository,
                '.github/scripts/pull-ci-images.sh',
              ),
              IMAGE_TAG: name === 'release' ? '1.2.3-amd64' : '',
              PATH: `${directory}:${process.env.PATH}`,
              SOURCE_SHA: pullSource,
              RECEIPTS: name === 'release' ? '' : receipts,
              SERVICE_NAMES: JSON.stringify(selectedServices),
              TEST_CALLS: log,
              TEST_FAIL_STAGE: failureStage,
              TEST_FAIL_SERVICE: selectedServices[0]!,
            },
            repository,
          );
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
            const started = calls.filter((call) => call.startsWith('start '));
            // Other persistent workers may finish their own assigned images.
            expect(started.length).toBeGreaterThanOrEqual(3);
            expect(started.length).toBeLessThanOrEqual(selectedServices.length);
            expect(
              calls.filter((call) => call.startsWith('end ')),
            ).toHaveLength(started.length);
            if (failureStage === 'pull')
              expect(
                calls.some((call) =>
                  call.startsWith(
                    `tag ghcr.io/tale-project/tale/tale-${selectedServices[0]}`,
                  ),
                ),
              ).toBe(false);
            expect(
              calls.some((call) =>
                call.endsWith(' tale-sandbox-runtime:latest'),
              ),
            ).toBe(false);
          } else {
            expect(result.code, result.stdout + result.stderr).toBe(0);
            expect(
              calls.filter((call) => call.startsWith('start ')),
            ).toHaveLength(selectedServices.length);
            expect(
              calls.some((call) =>
                call.endsWith(' tale-sandbox-runtime:latest'),
              ),
            ).toBe(selectedServices.includes('sandbox-runtime'));
          }
        }
      },
    );
  },
);

describe.skipIf(process.platform === 'win32')(
  'Build selects the affected container stacks',
  () => {
    test.each(['web', 'docs', 'ui-docs', 'ai-gateway', 'storybook'])(
      '%s changes do not build the unrelated platform stack',
      async (service) => {
        const matrix = findStep(
          (await workflow()).jobs.changes!,
          'Compute service matrix',
        );
        const result = await execute(matrix.run!, {
          CANDIDATE_SHA: '',
          CHANGES: JSON.stringify([service]),
          CI_TESTS: 'false',
          STORYBOOK: String(service === 'storybook'),
          IMAGE_INPUTS: 'false',
        });
        expect(result.code, result.stdout + result.stderr).toBe(0);
        expect(outputs(result.output).stack).toBe('false');
      },
    );

    test('all composed services and CI harness changes retain the complete stack', async () => {
      const build = await workflow();
      const matrix = findStep(build.jobs.changes!, 'Compute service matrix');
      for (const service of build.jobs.build!.strategy!.matrix!.service!) {
        const result = await execute(matrix.run!, {
          CANDIDATE_SHA: '',
          CHANGES: JSON.stringify([service]),
          CI_TESTS: 'false',
          STORYBOOK: 'false',
          IMAGE_INPUTS: 'false',
        });
        expect(result.code, result.stdout + result.stderr).toBe(0);
        expect(outputs(result.output).stack).toBe('true');
      }
      const harness = await execute(matrix.run!, {
        CANDIDATE_SHA: '',
        CHANGES: '["ci_tests"]',
        CI_TESTS: 'true',
        STORYBOOK: 'false',
        IMAGE_INPUTS: 'false',
      });
      expect(harness.code).toBe(0);
      expect(outputs(harness.output).stack).toBe('true');
      for (const id of [
        'build',
        'smoke-test',
        'image-validate',
        'smoke-test-fork',
        'image-validate-fork',
      ])
        expect(build.jobs[id]!.if).toContain(
          "needs.changes.outputs.stack == 'true'",
        );
      expect(build.jobs.build!.if).toContain(
        'github.event.pull_request.head.repo.fork != true',
      );
    });

    test('root build inputs validate every workspace image and keep candidate breadth', async () => {
      const build = await workflow();
      const filters = parse(
        String(findStep(build.jobs.changes!, 'Filter paths').with!.filters),
      ) as Record<string, string[]>;
      const matrix = findStep(build.jobs.changes!, 'Compute service matrix');
      for (const candidate of ['', source]) {
        const result = await execute(matrix.run!, {
          CANDIDATE_SHA: candidate,
          CHANGES: '["image_inputs"]',
          CI_TESTS: 'false',
          STORYBOOK: 'false',
          IMAGE_INPUTS: 'true',
        });
        expect(result.code, result.stdout + result.stderr).toBe(0);
        const values = outputs(result.output);
        const services = JSON.parse(values.list!) as string[];
        for (const service of [
          'platform',
          'web',
          'docs',
          'ui-docs',
          'ai-gateway',
        ])
          expect(services).toContain(service);
        expect(services).not.toContain('image_inputs');
        expect(values.stack).toBe('true');
        expect(values.storybook).toBe('true');
        expect(services.toSorted()).toEqual(
          Object.keys(filters)
            .filter(
              (key) => !['storybook', 'ci_tests', 'image_inputs'].includes(key),
            )
            .toSorted(),
        );
      }
      for (const input of [
        'patches/postgres.patch',
        'tools/cli/package.json',
        'configs/platform/system/harnesses/gemini/harness.yml',
      ]) {
        for (const event of ['pull_request', 'push'])
          expect(
            build.on[event]!.paths!.some((pattern) =>
              new Bun.Glob(pattern).match(input),
            ),
          ).toBe(true);
      }
      for (const input of [
        'bun.lock',
        'patches/postgres.patch',
        'tools/cli/package.json',
        'tsconfig.dom.json',
      ])
        expect(matches(filters.image_inputs!, input)).toBe(true);
    });
  },
);

test('standalone container tests run for their own harness and shared stack inputs', async () => {
  const build = await workflow();
  const filters = parse(
    String(findStep(build.jobs.changes!, 'Filter paths').with!.filters),
  ) as Record<string, string[]>;
  for (const service of ['web', 'docs', 'ui-docs', 'ai-gateway']) {
    for (const input of [
      `compose.${service}.yml`,
      `compose.${service}.test.yml`,
      '.env.test',
      `services/platform/tests/integration/container-${service}-test.ts`,
      'services/platform/tests/integration/static-site-test.ts',
      'services/platform/tests/integration/lib/docker.ts',
    ]) {
      expect(matches(filters[service]!, input)).toBe(true);
      for (const event of ['pull_request', 'push'])
        expect(
          build.on[event]!.paths!.some((pattern) =>
            new Bun.Glob(pattern).match(input),
          ),
        ).toBe(true);
    }
  }
});

test('every declared workspace manifest selects the workspace image consumers', async () => {
  const build = await workflow();
  const filters = parse(
    String(findStep(build.jobs.changes!, 'Filter paths').with!.filters),
  ) as Record<string, string[]>;
  const { workspaces } = JSON.parse(
    await readFile(join(repository, 'package.json'), 'utf8'),
  ) as { workspaces: string[] };
  expect(workspaces.length).toBeGreaterThan(0);
  for (const workspace of workspaces) {
    const manifest = `${workspace.replaceAll('*', 'example')}/package.json`;
    expect(matches(filters.image_inputs!, manifest), manifest).toBe(true);
    for (const event of ['pull_request', 'push'])
      expect(
        build.on[event]!.paths!.some((pattern) =>
          new Bun.Glob(pattern).match(manifest),
        ),
        `${event}: ${manifest}`,
      ).toBe(true);
  }
});

test('standalone compose edits do not select the unrelated stack harness', async () => {
  const filters = parse(
    String(
      findStep((await workflow()).jobs.changes!, 'Filter paths').with!.filters,
    ),
  ) as Record<string, string[]>;
  for (const service of ['web', 'docs', 'ui-docs', 'ai-gateway']) {
    for (const path of [
      `compose.${service}.yml`,
      `compose.${service}.test.yml`,
    ]) {
      expect(matches(filters[service]!, path), path).toBe(true);
      expect(matches(filters.ci_tests!, path), path).toBe(false);
    }
  }
  expect(matches(filters.ci_tests!, 'compose.test.yml')).toBe(true);
});

test('direct config validation avoids starting an unused Turbo cache server', async () => {
  expect(
    findStep((await workflow()).jobs.build!, 'Setup toolchain').with![
      'start-turbo-cache'
    ],
  ).toBe('false');
});

test('native release builds reuse isolated architecture caches without adding runner pressure', async () => {
  const build = (await workflow('release')).jobs.build!;
  const image = findStep(build, 'Build and push');
  expect(build.strategy!['max-parallel']).toBe(6);
  expect(image.with!['cache-from']).toContain(
    'ref=${{ env.REGISTRY }}/${{ github.repository }}/tale-${{ matrix.service.name }}-buildcache:${{ matrix.arch.name }}',
  );
  expect(image.with!['cache-from']).toContain("matrix.arch.name == 'amd64'");
  expect(image.with!['cache-to']).toBe(
    'type=registry,ref=${{ env.REGISTRY }}/${{ github.repository }}/tale-${{ matrix.service.name }}-buildcache:${{ matrix.arch.name }},mode=max,ignore-error=true',
  );
});
