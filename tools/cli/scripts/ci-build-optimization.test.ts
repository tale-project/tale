import { afterEach, describe, expect, test } from 'bun:test';
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';

import { create as createGlob } from '@actions/glob';
import picomatch from 'picomatch';
import { parse } from 'yaml';

import { BUILD_FILTERS, buildScope } from './ci-ready';

type Step = {
  name?: string;
  uses?: string;
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
      'continue-on-error'?: boolean;
      permissions?: Record<string, string>;
      needs?: string[];
      strategy?: {
        'max-parallel'?: number;
        matrix?: {
          service?: string[] | string;
          include?: { os: string; platform?: string; cross?: boolean }[];
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

test.each([
  'db',
  'proxy',
  'platform',
  'sandbox',
  'web',
  'docs',
  'ui-docs',
  'ai-gateway',
])(
  '%s version metadata does not invalidate runtime filesystem work',
  async (service) => {
    const dockerfile = await readFile(
      join(repository, `services/${service}/Dockerfile`),
      'utf8',
    );
    const stages = dockerfile
      .split(/^(?=FROM\s)/m)
      .filter((stage) => /^FROM\s/.test(stage));
    const versioned = stages.filter((stage) =>
      /^ARG VERSION(?:=|\s*$)/m.test(stage),
    );
    expect(versioned.length).toBeGreaterThan(0);
    for (const stage of versioned) {
      const version = stage.search(/^ARG VERSION(?:=|\s*$)/m);
      const filesystem = [...stage.matchAll(/^(?:RUN|COPY|ADD)\s/gm)];
      expect(filesystem.length).toBeGreaterThan(0);
      for (const instruction of filesystem) {
        expect(
          instruction.index,
          `${service}: ${stage.split('\n')[0]}`,
        ).toBeLessThan(version);
      }
      // ARG values implicitly enter every later RUN environment, even if the
      // command never expands VERSION. Keep the declaration, not just LABEL,
      // below all file operations. The shipped metadata still reads that ARG.
      expect(stage.slice(0, version)).not.toContain('${VERSION}');
      const metadata = stage
        .slice(version)
        .split(/\r?\n/)
        .filter((line) => !/^\s*#/.test(line))
        .join('\n')
        .replace(/\\\r?\n\s*/g, ' ');
      expect(metadata).toMatch(
        /^ENV\s+[^\n]*\bTALE_VERSION=\$\{VERSION\}(?:\s|$)/m,
      );
      if (/^LABEL\s/m.test(metadata)) {
        expect(metadata).toContain(
          'org.opencontainers.image.version="${VERSION}"',
        );
      }
    }
  },
);

async function workflow(name = 'build'): Promise<Workflow> {
  return parse(
    await readFile(join(repository, `.github/workflows/${name}.yml`), 'utf8'),
  ) as Workflow;
}

async function scopePaths(name: string): Promise<string[]> {
  const policies = parse(
    await readFile(join(repository, '.github/ci-scope.yml'), 'utf8'),
  ) as Record<string, string[]>;
  return policies[name]!;
}

async function buildFilters(): Promise<Record<string, string[]>> {
  const file = await workflow();
  const policyPath = String(
    findStep(file.jobs.changes!, 'Filter paths').with!.filters,
  );
  const policies = parse(
    await readFile(join(repository, policyPath), 'utf8'),
  ) as Record<string, string[]>;
  return Object.fromEntries(
    Object.entries(policies)
      .filter(([name]) => name.startsWith('build_'))
      .map(([name, globs]) => [name.slice(6), globs]),
  );
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
  // Resolve before a negative-control fixture replaces PATH with its own bin.
  const shell = Bun.which(process.platform === 'darwin' ? '/bin/bash' : 'bash');
  if (!shell)
    throw new Error('Build CI fixtures require Bash on the host PATH');
  const child = Bun.spawn([shell, '-euo', 'pipefail', '-c', script], {
    cwd: cwd ?? directory,
    env: {
      PATH: process.env.PATH,
      GITHUB_OUTPUT: output,
      EVENT_NAME: 'push',
      FULL_SCOPE: 'false',
      ...env,
    },
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
  'workflow shell fixtures launch without adding Bash to their isolated PATH',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tale-build-ci-path-'));
    directories.push(directory);
    const result = await execute(
      `printf '%s\\n' "$PATH"
if command -v bash >/dev/null 2>&1; then
  printf 'Bash unexpectedly available in fixture PATH\\n' >&2
  exit 17
fi
printf 'shell-started\\n'
`,
      { PATH: directory },
      directory,
    );
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toBe(`${directory}\nshell-started\n`);
    expect(result.stderr).toBe('');
  },
);

test.skipIf(process.platform === 'win32')(
  'standalone site changes avoid the platform stack while shared build inputs retain full coverage',
  async () => {
    const file = await workflow('build');
    const filters = parse(
      await readFile(
        join(
          repository,
          String(step(file, 'changes', 'Filter paths').with?.filters),
        ),
        'utf8',
      ),
    ) as Record<string, string[]>;
    expect(file.on.pull_request?.paths).toBeUndefined();
    const pushPaths = file.on.push?.paths;
    if (!pushPaths) throw new Error('Build push paths are missing');
    expect(filters.build).toEqual(pushPaths);
    expect(
      Object.keys(filters)
        .filter((name) => name.startsWith('build_'))
        .map((name) => name.slice(6))
        .toSorted(),
    ).toEqual([...BUILD_FILTERS].toSorted());
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
      [
        'tools/cli/scripts/check-sbom-hashes.ts',
        ['platform', 'web', 'docs', 'ui-docs', 'ai-gateway'],
        true,
      ],
    ];
    for (const [path, services, stack] of cases) {
      expect(matches(filters.build!, path), path).toBe(true);
      const changes = Object.keys(filters).filter(
        (key) => key.startsWith('build_') && matches(filters[key]!, path),
      );
      const frozen = buildScope(
        Object.fromEntries(
          BUILD_FILTERS.map((name) => [
            name,
            String(changes.includes(`build_${name}`)),
          ]),
        ),
        false,
      );
      for (const event of ['push', 'pull_request']) {
        const result = await execute(
          step(file, 'changes', 'Compute service matrix').run!,
          {
            CANDIDATE_SHA: '',
            EVENT_NAME: event,
            FULL_SCOPE: 'false',
            PR_CHANGES: frozen.changes,
            PR_CI_TESTS: frozen.ci_tests,
            PR_STORYBOOK: frozen.storybook,
            CHANGES: JSON.stringify(changes),
            CI_TESTS: String(changes.includes('build_ci_tests')),
            STORYBOOK: String(changes.includes('build_storybook')),
            IMAGE_INPUTS: String(changes.includes('build_image_inputs')),
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
      provenance: false,
    });
    expect(build.uses).toBe(
      'docker/bake-action@018cb6412ab401ebaa809aa5f85966b74628600f',
    );
    const writer =
      "github.event_name == 'push' && github.ref == 'refs/heads/main'";
    expect(step(file, 'build', 'Build and push').with?.['cache-to']).toContain(
      writer,
    );
    expect(build.with?.set).toBe(
      `*.cache-from=type=gha,scope=${service}\n` +
        `\${{ ${writer} && format('*.cache-to=type=gha,scope=${service},mode=max,ghtoken={0},repository={1}', secrets.GITHUB_TOKEN, github.repository) || '' }}\n`,
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
    ).toContain('-buildcache:${{ matrix.arch.name }}');
    expect(
      step(file, 'build', 'Build and push').with?.['cache-from'],
    ).not.toContain('type=gha');
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

test('cross CLI builds isolate filtered dependencies and Windows keeps its store beside the checkout', async () => {
  const file = await workflow('cli');
  const configure = step(file, 'build', 'Configure Bun install cache');
  const cache = step(file, 'build', 'Restore Bun install cache');
  const save = step(file, 'build', 'Save installed Bun downloads');
  const install = step(file, 'build', 'Install dependencies');
  expect(configure.if).toBe("matrix.cross || runner.os == 'Windows'");
  expect(configure.env?.CROSS).toBe('${{ matrix.cross }}');
  expect(configure.run).toContain(
    "printf 'BUN_INSTALL_CACHE_DIR=%s/bun-cli-cache\\n'",
  );
  expect(configure.run).toContain(
    'require("node:path").win32.resolve(process.env.GITHUB_WORKSPACE, "..", ".tale-bun-install-cache")',
  );
  expect(cache.with?.path).toBe(
    "${{ (matrix.cross || runner.os == 'Windows') && env.BUN_INSTALL_CACHE_DIR || '~/.bun/install/cache' }}",
  );
  expect(save.with?.path).toBe(cache.with?.path);
  expect(cache.with?.key).toBe(
    "${{ matrix.cross && 'bun-cli-install' || 'bun-install' }}-${{ runner.os }}-${{ runner.arch }}-1.4.2-${{ hashFiles('bun.lock', 'package.json', 'packages/*/package.json', 'services/*/package.json', 'services/sandbox-runtime/daemon/package.json', 'configs/platform/custom/skills/*/package.json', 'tools/*/package.json', 'patches/**', 'bunfig.toml') }}",
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
  'CLI cache configuration preserves cross stores and places Windows outside its checkout on the same volume',
  async () => {
    const configure = step(
      await workflow('cli'),
      'build',
      'Configure Bun install cache',
    );
    const directory = await mkdtemp(join(tmpdir(), 'tale-cli-cache-ci-'));
    directories.push(directory);
    const environment = join(directory, 'environment');
    for (const workspace of [
      'D:/a/repo with spaces/tale',
      'D:\\a\\repo with spaces\\tale',
    ]) {
      for (const cross of ['true', 'false', '']) {
        await writeFile(environment, '');
        const result = await execute(configure.run!, {
          CROSS: cross,
          GITHUB_ENV: environment,
          GITHUB_WORKSPACE: workspace,
          RUNNER_TEMP: 'E:/runner temp',
        });
        expect(result.code, result.stdout + result.stderr).toBe(0);
        const configured = outputs(await readFile(environment, 'utf8'));
        expect(Object.keys(configured)).toEqual(['BUN_INSTALL_CACHE_DIR']);
        expect(configured.BUN_INSTALL_CACHE_DIR).toBe(
          cross === 'true'
            ? 'E:/runner temp/bun-cli-cache'
            : 'D:\\a\\repo with spaces\\.tale-bun-install-cache',
        );
        if (cross !== 'true') {
          const checkout = win32.resolve(workspace);
          const cache = win32.resolve(configured.BUN_INSTALL_CACHE_DIR!);
          expect(configured.BUN_INSTALL_CACHE_DIR).toBe(cache);
          expect(win32.parse(cache).root).toBe(win32.parse(checkout).root);
          expect(win32.relative(checkout, cache)).toBe(
            '..\\.tale-bun-install-cache',
          );
          // macOS/Linux do not have a Windows drive filesystem. Preserve the
          // drive and segments using portable separators for the real cache
          // glob validator; the native win32 assertions above prove location.
          const portable = (path: string) => path.replaceAll('\\', '/');
          await expect(
            createGlob(portable(`${workspace}/../.tale-bun-install-cache`)),
          ).rejects.toThrow("Relative pathing '.' and '..' is not allowed");
          const accepted = await createGlob(portable(cache));
          expect(accepted.getSearchPaths()).toHaveLength(1);
        }
      }
    }
  },
);

test('the pinned cache glob consumer rejects the old sibling path and matches a normalized populated store', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tale-cli-cache-consumer-'));
  directories.push(directory);
  const checkout = join(directory, 'checkout with spaces');
  const cache = resolve(checkout, '..', '.tale-bun-install-cache');
  await mkdir(checkout);
  await mkdir(cache);
  const packageFile = join(cache, 'package.json');
  await writeFile(packageFile, '{"name":"synthetic-cached-package"}');

  // This executes @actions/glob 0.5.1, the exact consumer in cache v5.0.5.
  // Resolving only while comparing paths would miss the hosted save failure.
  await expect(
    createGlob(`${checkout}/../.tale-bun-install-cache`),
  ).rejects.toThrow("Relative pathing '.' and '..' is not allowed");
  const accepted = await createGlob(cache);
  expect(await accepted.glob()).toContain(packageFile);
});

test('all five CLI rows configure their cache and execute the actual frozen install', async () => {
  const file = await workflow('cli');
  const configure = step(file, 'build', 'Configure Bun install cache');
  const install = step(file, 'build', 'Install dependencies');
  const matrix = file.jobs.build?.strategy?.matrix?.include ?? [];
  const cases: Record<
    string,
    { runnerOS: string; cross: boolean; cacheName?: string }
  > = {
    linux: { runnerOS: 'Linux', cross: false },
    'linux-arm64': {
      runnerOS: 'Linux',
      cross: true,
      cacheName: 'bun-cli-cache',
    },
    macos: { runnerOS: 'macOS', cross: false },
    'macos-x64': {
      runnerOS: 'macOS',
      cross: true,
      cacheName: 'bun-cli-cache',
    },
    windows: {
      runnerOS: 'Windows',
      cross: false,
      cacheName: '.tale-bun-install-cache',
    },
  };
  expect(matrix.map((entry) => entry.platform).toSorted()).toEqual(
    Object.keys(cases).toSorted(),
  );
  for (const entry of matrix) {
    const expected = cases[entry.platform ?? ''];
    if (!expected) throw new Error(`Unknown CLI row ${entry.platform}`);
    expect(entry.cross ?? false).toBe(expected.cross);
    const directory = await mkdtemp(join(tmpdir(), 'tale-cli-cache-ci-'));
    directories.push(directory);
    const runnerTemp = join(directory, 'runner temp with spaces');
    const workspace = join(directory, 'checkout with spaces');
    const envFile = join(directory, 'github-env');
    await writeFile(envFile, '');
    const environment = {
      CROSS: entry.cross ? 'true' : '',
      RUNNER_OS: expected.runnerOS,
      RUNNER_TEMP: runnerTemp,
      GITHUB_WORKSPACE: workspace,
      GITHUB_ENV: envFile,
    };
    // The literal workflow condition above holds this runner-level selection.
    // Run its actual configuration body only when that step is selected.
    const configured = await execute(
      `if [ "$CROSS" = true ] || [ "$RUNNER_OS" = Windows ]; then
${configure.run}
fi`,
      environment,
      directory,
    );
    expect(configured.code, configured.stdout + configured.stderr).toBe(0);
    const cacheEnvironment = outputs(await readFile(envFile, 'utf8'));
    const cacheDirectory =
      expected.runnerOS === 'Windows'
        ? win32.resolve(workspace, '..', '.tale-bun-install-cache')
        : expected.cacheName
          ? `${runnerTemp}/${expected.cacheName}`
          : '';
    expect(cacheEnvironment).toEqual(
      cacheDirectory ? { BUN_INSTALL_CACHE_DIR: cacheDirectory } : {},
    );
    // Mock only Bun's process boundary. The workflow's install branches and
    // environment propagation execute unchanged, without installing packages.
    const installed = await execute(
      `bun() {
  printf 'cache=%s\\n' "\${BUN_INSTALL_CACHE_DIR:-}"
  printf 'argument=%s\\n' "$@"
}
${install.run}`,
      { ...environment, ...cacheEnvironment },
      directory,
    );
    expect(installed.code, installed.stdout + installed.stderr).toBe(0);
    expect(installed.stdout.trimEnd().split('\n')).toEqual([
      `cache=${cacheDirectory}`,
      'argument=install',
      'argument=--frozen-lockfile',
      ...(expected.cross ? ['argument=--filter', 'argument=@tale/cli'] : []),
    ]);
  }
});

describe('Windows cache locality diagnostics', () => {
  test('the trusted inline observation follows cache save on native Windows only', async () => {
    const file = await workflow('cli');
    const probe = step(file, 'build', 'Observe Windows Bun cache locality');
    const names = file.jobs.build!.steps.map((entry) => entry.name);
    expect(probe.if).toBe("runner.os == 'Windows' && !matrix.cross");
    expect(probe.run).toContain('bun_cache_path="$(bun pm cache)"');
    expect(probe.run).toContain(
      'BUN_INSTALL_CACHE_OBSERVED="$bun_cache_path" bun -e',
    );
    expect(probe.run).not.toContain('bun run');
    expect(names.indexOf('Save installed Bun downloads')).toBeLessThan(
      names.indexOf(probe.name),
    );
    expect(names.indexOf(probe.name)).toBeLessThan(
      names.indexOf('Generate embedded files'),
    );
  });

  async function observe(
    mode:
      | 'linked'
      | 'copied'
      | 'alias'
      | 'missing-file'
      | 'missing-package'
      | 'missing-cache'
      | 'cli-local'
      | 'wrong-version'
      | 'wrong-name'
      | 'directory'
      | 'multiple',
    adapters?: { stat?: string; volume?: string },
    cacheExit = 0,
    emptyCache = false,
  ) {
    const directory = await mkdtemp(join(tmpdir(), 'tale-bun-locality-'));
    directories.push(directory);
    const cache = join(directory, 'cache with spaces');
    const workspace = join(directory, 'workspace with spaces');
    const cli = join(workspace, 'tools/cli');
    const installedRoot = join(
      mode === 'cli-local' ? cli : workspace,
      'node_modules/typescript',
    );
    const cachedRoot = join(cache, 'typescript@metadata-discovered-suffix');
    await mkdir(cli, { recursive: true });
    await writeFile(join(cli, 'package.json'), '{}');
    await mkdir(join(cachedRoot, 'lib'), { recursive: true });
    await writeFile(
      join(cachedRoot, 'package.json'),
      JSON.stringify({
        name: mode === 'wrong-name' ? 'different-package' : 'typescript',
        version: mode === 'wrong-version' ? '0.0.1' : '6.0.2',
      }),
    );
    const installedFile = join(installedRoot, 'lib/typescript.js');
    const cachedFile = join(cachedRoot, 'lib/typescript.js');
    if (mode !== 'missing-package') {
      await mkdir(join(installedRoot, 'lib'), { recursive: true });
      await writeFile(
        join(installedRoot, 'package.json'),
        JSON.stringify({ name: 'typescript', version: '6.0.2' }),
      );
      await writeFile(installedFile, 'package contents must never be printed');
      if (mode === 'linked') await link(installedFile, cachedFile);
      else if (mode === 'alias') await symlink(installedFile, cachedFile);
      else if (mode === 'directory') await mkdir(cachedFile);
      else if (mode !== 'missing-file')
        await copyFile(installedFile, cachedFile);
      if (mode === 'multiple') {
        const secondRoot = join(cache, 'typescript@another-layout-suffix');
        await mkdir(join(secondRoot, 'lib'), { recursive: true });
        await copyFile(
          join(installedRoot, 'package.json'),
          join(secondRoot, 'package.json'),
        );
        await link(installedFile, join(secondRoot, 'lib/typescript.js'));
      }
    }
    if (mode === 'missing-cache')
      await rm(cache, { recursive: true, force: true });
    const preload = join(directory, 'stat-adapter.ts');
    const queryCalls = join(directory, 'volume-query-calls');
    await writeFile(queryCalls, '');
    await writeFile(
      preload,
      [
        adapters?.volume ??
          volumeAdapter('{ status: 0, stdout: "NTFS", stderr: "" }'),
        adapters?.stat,
      ]
        .filter(Boolean)
        .join('\n'),
    );
    const file = await workflow('cli');
    const probe = step(file, 'build', 'Observe Windows Bun cache locality');
    // Mock only cache/volume commands and optional fs identity edge cases.
    // The workflow body and actual installed/cache file layout run as-is.
    const result = await execute(
      `bun() {
  if [ "$#" -eq 2 ] && [ "$1" = pm ] && [ "$2" = cache ]; then
    [ "$PROBE_CACHE_EXIT" -eq 0 ] || return "$PROBE_CACHE_EXIT"
    printf '%s\\n' "$PROBE_CACHE"
  elif [ -n "$PROBE_PRELOAD" ]; then
    "$PROBE_BUN" --preload "$PROBE_PRELOAD" "$@"
  else
    "$PROBE_BUN" "$@"
  fi
}
${probe.run}`,
      {
        PROBE_BUN: process.execPath,
        PROBE_CACHE: emptyCache ? '' : cache,
        PROBE_CACHE_EXIT: String(cacheExit),
        PROBE_PRELOAD: preload,
        PROBE_QUERY_CALLS: queryCalls,
        BUN_INSTALL_CACHE_DIR: cache,
        GITHUB_WORKSPACE: workspace,
        RUNNER_TEMP: directory,
      },
      cli,
    );
    expect(result.stdout).not.toContain('package contents');
    return {
      ...result,
      cache,
      queryCalls: (await readFile(queryCalls, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    };
  }

  test.each([
    ['linked', 'hardlinked', 1],
    ['copied', 'not-linked-to-sampled-cache-file', 1],
    ['missing-file', 'unknown', 1],
    ['missing-package', 'unknown', 0],
    ['missing-cache', 'unknown', 0],
    ['cli-local', 'not-linked-to-sampled-cache-file', 1],
    ['wrong-version', 'unknown', 0],
    ['wrong-name', 'unknown', 0],
    ['directory', 'unknown', 1],
    ['multiple', 'hardlinked', 2],
  ] as const)(
    'actual inline probe reports %s as %s',
    async (mode, status, count) => {
      const result = await observe(mode);
      expect(result.code, result.stdout + result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.status).toBe(status);
      expect(report.candidateCount).toBe(count);
      expect(report.selectedCache).toBe(result.cache);
      expect(report.observedCache).toBe(result.cache);
      expect(report.paths.workspace.directory).toBe(true);
      expect(report.paths.workspace.dev).toMatch(/^\d+$/);
      expect(report.paths.workspace.ino).toMatch(/^\d+$/);
      if (mode === 'linked' || mode === 'multiple') {
        const match = report.candidates.find(
          (entry: { status: string }) => entry.status === 'hardlinked',
        );
        expect(match.cached.path).not.toBe(report.installed.path);
        expect(match.cached.dev).toBe(report.installed.dev);
        expect(match.cached.ino).toBe(report.installed.ino);
        expect(BigInt(match.cached.nlink)).toBeGreaterThanOrEqual(2n);
        expect(BigInt(report.installed.nlink)).toBeGreaterThanOrEqual(2n);
      }
    },
  );

  test.skipIf(process.platform === 'win32')(
    'a symlink alias of one real file is unknown rather than a second hardlink',
    async () => {
      const result = await observe('alias');
      expect(result.code, result.stdout + result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.status).toBe('unknown');
      expect(report.candidates[0].cached.path).toBe(report.installed.path);
    },
  );

  test('the actual cache-directory command failure propagates before observation', async () => {
    const result = await observe('linked', undefined, 37);
    expect(result.code).toBe(37);
    expect(result.stdout).toBe('');
  });

  test('empty successful cache-directory output fails instead of claiming unknown', async () => {
    const result = await observe('linked', undefined, 0, true);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('bun pm cache returned an empty path');
  });

  const statAdapter = (expression: string) => `
import { mock } from 'bun:test';
import * as fs from 'node:fs';
const nativeStat = fs.statSync;
mock.module('node:fs', () => ({ ...fs, statSync(path, options) {
  const info = nativeStat(path, options);
  if (!String(path).endsWith('typescript.js')) return info;
  ${expression}
} }));
`;

  test.each([
    ['zero', 'return Object.assign(info, { dev: 0n });', 'unknown'],
    ['zero file ID', 'return Object.assign(info, { ino: 0n });', 'unknown'],
    [
      'matching identity with one link',
      'return Object.assign(info, { dev: 9007199254740993n, ino: 9007199254740995n, nlink: 1n });',
      'unknown',
    ],
    [
      'equal IDs above Number precision',
      'return Object.assign(info, { dev: 9007199254740993n, ino: 9007199254740995n, nlink: 2n });',
      'hardlinked',
    ],
    [
      'different IDs above Number precision',
      'return Object.assign(info, { dev: 9007199254740993n, ino: String(path).includes("node_modules") ? 9007199254740992n : 9007199254740993n, nlink: 2n });',
      'not-linked-to-sampled-cache-file',
    ],
  ])(
    'the inline BigInt observation preserves %s',
    async (_label, expression, status) => {
      const result = await observe('copied', { stat: statAdapter(expression) });
      expect(result.code, result.stdout + result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.status).toBe(status);
      if (status !== 'unknown')
        expect(report.installed.dev).toBe('9007199254740993');
    },
  );

  test('filesystem permission errors propagate instead of becoming unknown', async () => {
    const result = await observe('copied', {
      stat: statAdapter(
        'throw Object.assign(new Error("fixture denied stat"), { code: "EACCES" });',
      ),
    });
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('fixture denied stat');
  });

  const volumeAdapter = (result: string, body = '') => `
import { mock as volumeMock } from 'bun:test';
import { writeFileSync } from 'node:fs';
import * as childProcess from 'node:child_process';
import 'node:path';
Object.defineProperty(process, 'platform', { value: 'win32' });
volumeMock.module('node:child_process', () => ({ ...childProcess, spawnSync(command, args, options) {
  writeFileSync(process.env.PROBE_QUERY_CALLS, JSON.stringify({ command, args, path: options.env.TALE_BUN_PROBE_FILE }) + '\\n', { flag: 'a' });
  ${body}
  return ${result};
} }));
`;

  test.each([
    ['NTFS', 'hardlinked'],
    ['ReFS', 'unknown'],
    ['', 'unknown'],
  ])(
    'Windows requires confirmed NTFS for hardlink evidence (%s)',
    async (fileSystem, status) => {
      const result = await observe('linked', {
        volume: volumeAdapter(
          `{ status: 0, stdout: ${JSON.stringify(`${fileSystem}\r\n`)}, stderr: '' }`,
        ),
      });
      expect(result.code, result.stdout + result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.status).toBe(status);
      expect(report.installed.fileSystem).toBe(fileSystem || null);
      expect(report.candidates[0].cached.fileSystem).toBe(fileSystem || null);
      expect(result.queryCalls.map((call) => call.path).toSorted()).toEqual(
        [report.installed.path, report.candidates[0].cached.path].toSorted(),
      );
      for (const call of result.queryCalls) {
        expect(call.command).toBe('powershell.exe');
        expect(call.args.slice(0, 4)).toEqual([
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
        ]);
        expect(call.args[4]).toBe(
          '$ErrorActionPreference = "Stop"; $volumes = @(Get-Volume -FilePath $env:TALE_BUN_PROBE_FILE -ErrorAction Stop); if ($volumes.Count -eq 1) { [string]$volumes[0].FileSystem }',
        );
        expect(call.args[4]).not.toContain(call.path);
      }
    },
  );

  test('every resolved candidate requires its own NTFS volume confirmation', async () => {
    const result = await observe('linked', {
      volume: volumeAdapter(
        '{ status: 0, stdout: options.env.TALE_BUN_PROBE_FILE.includes("node_modules") ? "NTFS" : "ReFS", stderr: "" }',
      ),
    });
    expect(result.code, result.stdout + result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.installed.fileSystem).toBe('NTFS');
    expect(report.candidates[0].cached.fileSystem).toBe('ReFS');
    expect(report.status).toBe('unknown');
  });

  test.skipIf(process.platform === 'win32')(
    'the Windows query resolves aliases and memoizes the physical sample path',
    async () => {
      const result = await observe('alias', {
        volume: volumeAdapter('{ status: 0, stdout: "NTFS", stderr: "" }'),
      });
      expect(result.code, result.stdout + result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.status).toBe('unknown');
      expect(report.installed.path).toBe(report.candidates[0].cached.path);
      expect(result.queryCalls.map((call) => call.path)).toEqual([
        report.installed.path,
      ]);
    },
  );

  test.each([
    [
      'permission failure',
      '{ status: 1, stdout: "", stderr: "fixture denied volume" }',
      'fixture denied volume',
    ],
    [
      'missing executable',
      '{ error: Object.assign(new Error("fixture missing PowerShell"), { code: "ENOENT" }) }',
      'fixture missing PowerShell',
    ],
  ])(
    'volume query %s propagates outside optional layout reads',
    async (_label, query, message) => {
      const result = await observe('linked', { volume: volumeAdapter(query) });
      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(message);
      expect(result.queryCalls).toHaveLength(1);
    },
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
          CHANGES: JSON.stringify([`build_${service}`]),
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
          CHANGES: JSON.stringify([`build_${service}`]),
          CI_TESTS: 'false',
          STORYBOOK: 'false',
          IMAGE_INPUTS: 'false',
        });
        expect(result.code, result.stdout + result.stderr).toBe(0);
        expect(outputs(result.output).stack).toBe('true');
      }
      const harness = await execute(matrix.run!, {
        CANDIDATE_SHA: '',
        CHANGES: '["build_ci_tests"]',
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

    test('root build inputs and SBOM helper edits validate every workspace image and keep candidate breadth', async () => {
      const build = await workflow();
      const filters = await buildFilters();
      const matrix = findStep(build.jobs.changes!, 'Compute service matrix');
      const scan = build.jobs['vulnerability-scan']!;
      const publishedServices = build.jobs.build!.strategy!.matrix!.service;
      if (!Array.isArray(publishedServices))
        throw new Error('Build image matrix must list its published services');
      const sbomHelper = String(
        findStep(scan, 'Checkout SBOM hash guard').with!['sparse-checkout'],
      );
      expect(sbomHelper).toBe('tools/cli/scripts/check-sbom-hashes.ts');
      expect(build.on.pull_request!.paths).toBeUndefined();
      expect(await scopePaths('build')).toContain(sbomHelper);
      expect(build.on.push!.paths!).toContain(sbomHelper);
      expect(filters.image_inputs!).toContain(sbomHelper);
      const helperChanges = Object.keys(filters).filter((key) =>
        matches(filters[key]!, sbomHelper),
      );
      expect(helperChanges).toEqual(['image_inputs']);
      expect(scan.strategy?.matrix?.service).toBe(
        '${{ fromJson(needs.changes.outputs.scannable_services) }}',
      );
      expect(findStep(scan, 'Verify SBOM package hashes').if).toBe(
        'matrix.service == fromJSON(needs.changes.outputs.scannable_services)[0]',
      );
      for (const candidate of ['', source]) {
        const result = await execute(matrix.run!, {
          CANDIDATE_SHA: candidate,
          CHANGES: JSON.stringify(helperChanges.map((name) => `build_${name}`)),
          CI_TESTS: 'false',
          STORYBOOK: 'false',
          IMAGE_INPUTS: String(helperChanges.includes('image_inputs')),
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
        expect(values.ci_tests).toBe('true');
        const scannable = JSON.parse(values.scannable!) as string[];
        expect(scannable.toSorted()).toEqual(
          candidate ? [] : publishedServices.toSorted(),
        );
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
            (event === 'pull_request'
              ? await scopePaths('build')
              : build.on[event]!.paths!
            ).some((pattern) => new Bun.Glob(pattern).match(input)),
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
  const filters = await buildFilters();
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
          (event === 'pull_request'
            ? await scopePaths('build')
            : build.on[event]!.paths!
          ).some((pattern) => new Bun.Glob(pattern).match(input)),
        ).toBe(true);
    }
  }
});

test('every declared workspace manifest selects the workspace image consumers', async () => {
  const build = await workflow();
  const filters = await buildFilters();
  const { workspaces } = JSON.parse(
    await readFile(join(repository, 'package.json'), 'utf8'),
  ) as { workspaces: string[] };
  expect(workspaces.length).toBeGreaterThan(0);
  for (const workspace of workspaces) {
    const manifest = `${workspace.replaceAll('*', 'example')}/package.json`;
    expect(matches(filters.image_inputs!, manifest), manifest).toBe(true);
    for (const event of ['pull_request', 'push'])
      expect(
        (event === 'pull_request'
          ? await scopePaths('build')
          : build.on[event]!.paths!
        ).some((pattern) => new Bun.Glob(pattern).match(manifest)),
        `${event}: ${manifest}`,
      ).toBe(true);
  }
});

test('standalone compose edits do not select the unrelated stack harness', async () => {
  const filters = await buildFilters();
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

test('published image gates record remaining disk after every accepted-image probe', async () => {
  const file = await workflow();
  for (const job of ['smoke-test', 'image-validate']) {
    const steps = file.jobs[job]!.steps;
    const after = step(file, job, 'Log disk after image checks');
    const check = step(
      file,
      job,
      job === 'smoke-test'
        ? 'Run smoke tests'
        : 'Run image validation and sandbox runtime behavior',
    );
    expect(after.if).toBe('always()');
    expect(after.run).toBe(step(file, 'smoke-test', after.name!).run);
    expect(after.run).toContain('df -Pk /');
    expect(check.env?.SKIP_BUILD).toBe('true');
    expect(steps.indexOf(step(file, job, 'Reclaim disk space'))).toBeLessThan(
      steps.indexOf(step(file, job, 'Download image receipts')),
    );
    expect(
      steps.indexOf(step(file, job, 'Download image receipts')),
    ).toBeLessThan(steps.indexOf(step(file, job, 'Pull images from GHCR')));
    expect(
      steps.indexOf(step(file, job, 'Pull images from GHCR')),
    ).toBeLessThan(steps.indexOf(check));
    expect(steps.indexOf(check)).toBeLessThan(steps.indexOf(after));
    if (job === 'image-validate') {
      const upload = step(file, job, 'Upload image validation logs');
      expect(upload.if).toBe('always()');
      expect(steps.indexOf(check)).toBeLessThan(steps.indexOf(upload));
      expect(steps.indexOf(upload)).toBeLessThan(steps.indexOf(after));
    }
  }
});

test('native release builds reuse isolated architecture caches without adding runner pressure', async () => {
  const build = (await workflow('release')).jobs.build!;
  const image = findStep(build, 'Build and push');
  expect(build.strategy!['max-parallel']).toBe(6);
  expect(image.with!['cache-from']).toContain(
    'ref=${{ env.REGISTRY }}/${{ github.repository }}/tale-${{ matrix.service.name }}-buildcache:${{ matrix.arch.name }}',
  );
  expect(image.with!['cache-from']).not.toContain('type=gha');
  expect(image.with!['cache-to']).toBe(
    'type=registry,ref=${{ env.REGISTRY }}/${{ github.repository }}/tale-${{ matrix.service.name }}-buildcache:${{ matrix.arch.name }},mode=max,ignore-error=true',
  );
});

test('SARIF preserves all findings while direct SBOM analysis retains package hashes', async () => {
  const scan = (await workflow()).jobs['vulnerability-scan']!;
  const imageScans = scan.steps.filter((entry) =>
    entry.uses?.startsWith('aquasecurity/trivy-action@'),
  );
  expect(imageScans).toHaveLength(2);
  const trivyAction =
    'aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25';
  expect(imageScans.map((entry) => entry.uses)).toEqual([
    trivyAction,
    trivyAction,
  ]);
  expect(imageScans[0]!.with).toMatchObject({
    version: 'v0.70.0',
    format: 'json',
    output: '${{ matrix.service }}-trivy.json',
    'list-all-pkgs': 'true',
    scanners: 'vuln,secret',
    severity: 'UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL',
    trivyignores: '.trivyignore.yaml',
  });
  expect(scan['continue-on-error']).toBe(true);
  const inventory = findStep(scan, 'Generate SBOM (CycloneDX)');
  expect(inventory.with).toEqual({
    version: 'v0.70.0',
    'skip-setup-trivy': 'true',
    cache: 'false',
    'scan-type': 'image',
    'image-ref': imageScans[0]!.with!['image-ref'],
    format: 'cyclonedx',
    output: '${{ matrix.service }}-sbom.cdx.json',
  });
  // Trivy's persistent analysis-cache key omits its file-checksum option.
  // Reusing an earlier JSON entry would silently discard package hashes.
  expect(inventory.env).toEqual({ TRIVY_CACHE_BACKEND: 'memory' });
  expect(inventory.run).toBeUndefined();
  expect(inventory.if).toBeUndefined();
  expect(scan.needs).toEqual(['changes', 'build']);
  expect(scan.if).toContain('!cancelled()');
  expect(scan.if).toContain("needs.changes.outputs.scannable_services != '[]'");
  expect(scan.if).toContain('github.event.pull_request.head.repo.fork != true');
  const names = scan.steps.map((entry) => entry.name);
  const ordered = [
    'Run Trivy',
    'Generate SARIF',
    'Upload SARIF',
    'Generate SBOM (CycloneDX)',
    'Checkout SBOM hash guard',
    'Setup Bun for SBOM hash guard',
    'Verify SBOM package hashes',
    'Upload SBOM',
  ];
  expect(ordered.map((name) => names.indexOf(name))).toEqual(
    ordered.map((name) => names.indexOf(name)).toSorted((a, b) => a - b),
  );
  const conversion = findStep(scan, 'Generate SARIF');
  expect(conversion.if).toBeUndefined();
  expect(conversion.env).toEqual({ SERVICE: '${{ matrix.service }}' });
  expect(conversion.uses).toBeUndefined();
  const once =
    'matrix.service == fromJSON(needs.changes.outputs.scannable_services)[0]';
  for (const name of [
    'Checkout SBOM hash guard',
    'Setup Bun for SBOM hash guard',
    'Verify SBOM package hashes',
  ]) {
    expect(findStep(scan, name).if).toBe(once);
  }
  const helper = findStep(scan, 'Checkout SBOM hash guard');
  expect(helper.uses).toBe(
    'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd',
  );
  expect(helper.with).toEqual({
    ref: '${{ github.workflow_sha }}',
    path: '.ci-workflow',
    'persist-credentials': false,
    'sparse-checkout': 'tools/cli/scripts/check-sbom-hashes.ts',
    'sparse-checkout-cone-mode': false,
  });
  const bun = findStep(scan, 'Setup Bun for SBOM hash guard');
  expect(bun.uses).toBe(
    'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6',
  );
  expect(bun.with).toEqual({ 'bun-version': '1.4.2' });
  expect(findStep(scan, 'Verify SBOM package hashes').run).toBe(
    'bun .ci-workflow/tools/cli/scripts/check-sbom-hashes.ts',
  );
  const sourceCheckout = findStep(scan, 'Checkout');
  expect(sourceCheckout.with?.ref).toBe(
    '${{ needs.changes.outputs.candidate_sha }}',
  );
  expect(sourceCheckout.with?.path).toBeUndefined();
  const sarif = findStep(scan, 'Upload SARIF');
  expect(sarif.if).toBe(
    "always() && hashFiles(format('{0}-trivy.sarif', matrix.service)) != ''",
  );
  expect(sarif.with).toMatchObject({
    sarif_file: '${{ matrix.service }}-trivy.sarif',
    category: 'trivy-${{ matrix.service }}',
  });
  const sbom = findStep(scan, 'Upload SBOM');
  expect(sbom.if).toBe(
    "always() && hashFiles(format('{0}-sbom.cdx.json', matrix.service)) != ''",
  );
  expect(sbom.with).toMatchObject({
    name: 'sbom-${{ matrix.service }}',
    path: '${{ matrix.service }}-sbom.cdx.json',
    'retention-days': 14,
    'if-no-files-found': 'ignore',
  });
});

describe.skipIf(process.platform === 'win32')('Trivy SARIF conversion', () => {
  const commands: [string, string[]][] = [
    [
      'Generate SARIF',
      [
        'convert',
        '--format',
        'sarif',
        '--severity',
        'UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL',
        '--ignorefile',
        '.trivyignore.yaml',
        '--output',
        'proxy-trivy.sarif',
        'proxy-trivy.json',
      ],
    ],
  ];

  async function fixture(expected: string[]) {
    const directory = await mkdtemp(join(tmpdir(), 'tale-trivy-convert-ci-'));
    directories.push(directory);
    const calls = join(directory, 'calls.json');
    await writeFile(join(directory, 'proxy-trivy.json'), '{}');
    await writeFile(
      join(directory, 'trivy'),
      `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
writeFileSync(process.env.TEST_CALLS, JSON.stringify(args));
if (JSON.stringify(args) !== process.env.TEST_ARGUMENTS) process.exit(18);
if (process.env.TEST_FAILURE === 'true') process.exit(17);
readFileSync(args.at(-1));
writeFileSync(args[args.indexOf('--output') + 1], 'converted');
`,
      { mode: 0o755 },
    );
    return {
      directory,
      calls,
      env: {
        PATH: `${directory}:${process.env.PATH}`,
        SERVICE: 'proxy',
        TEST_CALLS: calls,
        TEST_ARGUMENTS: JSON.stringify(expected),
      },
    };
  }

  test.each(commands)(
    '%s preserves arguments and propagates conversion failures',
    async (name, expected) => {
      const conversion = step(await workflow(), 'vulnerability-scan', name);
      for (const failure of ['false', 'true']) {
        const run = await fixture(expected);
        const result = await execute(
          conversion.run!,
          { ...run.env, TEST_FAILURE: failure },
          run.directory,
        );
        expect(JSON.parse(await readFile(run.calls, 'utf8'))).toEqual(expected);
        expect(result.code, result.stdout + result.stderr).toBe(
          failure === 'true' ? 17 : 0,
        );
      }
    },
  );
});

test.skipIf(process.platform === 'win32')(
  'SBOM hash guard fails closed without the installed pinned engine',
  async () => {
    const guard = step(
      await workflow(),
      'vulnerability-scan',
      'Verify SBOM package hashes',
    );
    for (const mode of ['absent', 'wrong-version', 'engine-error']) {
      const directory = await mkdtemp(join(tmpdir(), 'tale-sbom-engine-ci-'));
      directories.push(directory);
      const helper = 'tools/cli/scripts/check-sbom-hashes.ts';
      const helperPath = join(directory, '.ci-workflow', helper);
      await mkdir(resolve(helperPath, '..'), { recursive: true });
      await writeFile(helperPath, await readFile(join(repository, helper)));
      await symlink(process.execPath, join(directory, 'bun'));
      if (mode !== 'absent') {
        await writeFile(
          join(directory, 'trivy'),
          `#!${process.execPath}
if (!process.argv.includes('--version')) throw new Error('A rejected engine must not scan');
${mode === 'engine-error' ? 'process.exit(17);' : 'console.log("Version: 0.71.0");'}
`,
          { mode: 0o755 },
        );
      }
      const result = await execute(
        guard.run!,
        { PATH: directory, TMPDIR: directory },
        directory,
      );
      expect(result.code, result.stdout + result.stderr).toBe(1);
      expect(result.stderr).toContain(
        mode === 'absent'
          ? 'The installed Trivy 0.70.0 binary is required'
          : mode === 'wrong-version'
            ? 'Expected Trivy 0.70.0'
            : 'version failed',
      );
    }
  },
);
