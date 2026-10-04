import { beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { z } from 'zod';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CHECK_TASKS = [
  'lint',
  'typecheck',
  'test',
  'test:ui',
  'test:browser',
  'test:coverage',
  'storybook:build',
];
const summarySchema = z.object({
  globalCacheInputs: z.object({ files: z.record(z.string(), z.string()) }),
  tasks: z.array(
    z.object({
      taskId: z.string(),
      task: z.string(),
      hash: z.string(),
      directory: z.string(),
      command: z.string(),
      inputs: z.record(z.string(), z.string()),
      dependencies: z.array(z.string()),
      resolvedTaskDefinition: z.object({
        cache: z.boolean(),
        outputs: z.array(z.string()),
      }),
    }),
  ),
});
type Task = z.infer<typeof summarySchema>['tasks'][number];

function repoInputs(task: Task): Set<string> {
  return new Set(
    Object.keys(task.inputs).map((file) =>
      relative(REPO_ROOT, resolve(REPO_ROOT, task.directory, file))
        .split(sep)
        .join('/'),
    ),
  );
}

describe('CI cache boundaries', () => {
  let summary: z.infer<typeof summarySchema>;
  let tasks: Map<string, Task>;

  beforeAll(() => {
    const run = spawnSync(
      process.execPath,
      [
        'x',
        'turbo',
        'run',
        ...CHECK_TASKS,
        'build',
        '--dry=json',
        '--cache=local:,remote:',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    if (run.status !== 0) {
      throw new Error(`turbo dry run failed: ${run.error ?? run.stderr}`);
    }
    summary = summarySchema.parse(
      JSON.parse(run.stdout.slice(run.stdout.indexOf('{'))),
    );
    tasks = new Map(summary.tasks.map((task) => [task.taskId, task]));
  }, 60_000);

  test('dependency sources invalidate checks without scheduling dependency checks', () => {
    const ownInputs = repoInputs(tasks.get('@tale/cli#test')!);
    for (const task of summary.tasks) {
      if (
        !CHECK_TASKS.includes(task.task) ||
        task.command === '<NONEXISTENT>'
      ) {
        continue;
      }
      const manifestPath = `${task.directory.split(sep).join('/')}/package.json`;
      expect(
        ownInputs.has(manifestPath),
        `CLI cache guard reads ${manifestPath}`,
      ).toBe(true);
      const manifest = z
        .object({
          dependencies: z.record(z.string(), z.string()).optional(),
          devDependencies: z.record(z.string(), z.string()).optional(),
        })
        .parse(
          JSON.parse(
            readFileSync(
              join(REPO_ROOT, task.directory, 'package.json'),
              'utf8',
            ),
          ),
        );
      const dependencies = Object.entries({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      })
        .filter(([, version]) => version.startsWith('workspace:'))
        .map(([name]) => name);
      for (const dependency of dependencies) {
        expect(task.dependencies, task.taskId).toContain(
          `${dependency}#transit`,
        );
        const transit = tasks.get(`${dependency}#transit`)!;
        expect(transit.command, transit.taskId).toBe('<NONEXISTENT>');
        expect(
          Object.keys(transit.inputs).length,
          transit.taskId,
        ).toBeGreaterThan(1);
        expect(
          task.dependencies.filter((id) => id === `${dependency}#${task.task}`),
          `${task.taskId} must stay parallel to ${dependency}'s checks`,
        ).toEqual([]);
      }
    }
    // Marketing UI itself consumes UI: the invalidation must reach its
    // consumers even if they do not import UI directly.
    expect(tasks.get('@tale/marketing-ui#transit')?.dependencies).toContain(
      '@tale/ui#transit',
    );
    expect(repoInputs(tasks.get('@tale/ui#transit')!)).toContain(
      'packages/ui/src/i18n/tests/index.ts',
    );
  });

  test('every root TypeScript family config contributes to task hashes', () => {
    const configs = readdirSync(REPO_ROOT).filter((name) =>
      /^tsconfig\..+\.json$/.test(name),
    );
    expect(configs.length).toBeGreaterThan(1);
    for (const config of configs) {
      expect(Object.keys(summary.globalCacheInputs.files)).toContain(config);
    }
  });

  test('the shared platform build cache includes catalog validation and its output', () => {
    const task = tasks.get('@tale/platform#build')!;
    expect(task.command).toContain('configs:validate');
    expect(task.resolvedTaskDefinition.outputs).toContain('dist/**');
    const inputs = repoInputs(task);
    const catalogs = Array.from(
      new Bun.Glob('configs/platform/**/*.{json,yml,yaml}').scanSync({
        cwd: REPO_ROOT,
        onlyFiles: true,
      }),
    );
    expect(catalogs.length).toBeGreaterThan(0);
    expect(
      catalogs.filter((file) => !inputs.has(file.split(sep).join('/'))),
    ).toEqual([]);
    expect(task.dependencies).toContain('@tale/ui#build');
    expect(task.dependencies).toContain('@tale/shared#build');
  });

  test('CLI source identity is regenerated and compiled rather than restored from another commit', () => {
    for (const name of ['generate', 'setup', 'build']) {
      expect(
        tasks.get(`@tale/cli#${name}`)?.resolvedTaskDefinition.cache,
        `@tale/cli#${name} reads git HEAD and clean-worktree state`,
      ).toBe(false);
    }
    // Checks may still replay, but only while the data embedded in generated
    // source is unchanged. Both entry points generate that same module.
    for (const name of ['generate', 'setup']) {
      const inputs = repoInputs(tasks.get(`@tale/cli#${name}`)!);
      for (const file of [
        'services/platform/backend/core/lib/config_store/value_hash.ts',
        'services/platform/lib/shared/utils/stable-stringify.ts',
        'configs/platform/system/harnesses/gemini/harness.yml',
      ]) {
        expect(inputs, `@tale/cli#${name}`).toContain(file);
      }
    }
    for (const name of ['lint', 'typecheck', 'test']) {
      const dependencies = tasks.get(`@tale/cli#${name}`)?.dependencies;
      expect(dependencies).toContain('@tale/cli#generate');
      expect(dependencies).not.toContain('@tale/cli#setup');
    }
  });
});

test('Bun download caches cannot restore a different runner architecture', () => {
  const action = z
    .object({
      runs: z.object({
        steps: z.array(
          z.object({
            name: z.string(),
            with: z.record(z.string(), z.unknown()).optional(),
          }),
        ),
      }),
    })
    .parse(
      parse(
        readFileSync(
          join(REPO_ROOT, '.github/actions/setup-turbo/action.yml'),
          'utf8',
        ),
      ),
    );
  const cache = action.runs.steps.find(
    (step) => step.name === 'Restore Bun install cache',
  );
  const prefix =
    'bun-install-${{ runner.os }}-${{ runner.arch }}-${{ inputs.bun-version }}-';
  const key = String(cache?.with?.key);
  expect(key).toStartWith(prefix);
  const workspaces = z
    .object({ workspaces: z.array(z.string()) })
    .parse(
      JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')),
    ).workspaces;
  for (const input of [
    'bun.lock',
    'package.json',
    'patches/**',
    ...workspaces.map((workspace) => `${workspace}/package.json`),
  ]) {
    expect(key, input).toContain(`'${input}'`);
  }
  expect(cache?.with?.['restore-keys']).toBe(`${prefix}\n`);
});

/** Real hash changes in a disposable monorepo: changing shared source must
 * invalidate its transitive consumers, while an unrelated workspace stays hot.
 * This also proves that ^build hashes source-only packages without a build script.
 */
test('transitive source edits invalidate only consumers, for builds and checks', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'tale-turbo-cache-'));
  const write = (file: string, value: unknown) => {
    writeFileSync(join(fixture, file), JSON.stringify(value));
  };
  try {
    const config = z
      .object({ tasks: z.record(z.string(), z.unknown()) })
      .passthrough()
      .parse(JSON.parse(readFileSync(join(REPO_ROOT, 'turbo.json'), 'utf8')));
    // Package-specific tasks have no corresponding packages in this fixture;
    // real-workspace dry-run assertions above cover those overrides.
    config.tasks = Object.fromEntries(
      Object.entries(config.tasks).filter(([name]) => !name.includes('#')),
    );
    write('turbo.json', config);
    write('package.json', {
      name: 'cache-proof',
      private: true,
      packageManager: 'bun@1.4.2',
      workspaces: ['packages/*'],
    });
    const scripts = Object.fromEntries(
      [...CHECK_TASKS, 'build'].map((name) => [name, 'echo checked']),
    );
    for (const [name, dependency] of [
      ['consumer', 'middle'],
      ['middle', 'source'],
      ['source', null],
      ['unrelated', null],
    ]) {
      mkdirSync(join(fixture, 'packages', name!), { recursive: true });
      write(`packages/${name}/package.json`, {
        name: `@cache/${name}`,
        version: '1.0.0',
        // Source-only workspace dependencies: the build graph still needs
        // their contents even though there is no build command to run.
        scripts: name === 'middle' || name === 'source' ? {} : scripts,
        dependencies: dependency
          ? { [`@cache/${dependency}`]: 'workspace:*' }
          : {},
      });
      write(`packages/${name}/source.json`, { value: 'before' });
    }
    const install = spawnSync(
      process.execPath,
      ['install', '--lockfile-only', '--ignore-scripts'],
      { cwd: fixture, encoding: 'utf8' },
    );
    expect(install.status, install.stderr).toBe(0);
    const hashes = () => {
      const run = spawnSync(
        process.execPath,
        [
          'x',
          'turbo',
          'run',
          ...CHECK_TASKS,
          'build',
          `--cwd=${fixture}`,
          '--filter=@cache/consumer',
          '--filter=@cache/unrelated',
          '--dry=json',
          '--cache=local:,remote:',
        ],
        { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      );
      if (run.status !== 0) {
        throw new Error(
          `fixture turbo dry run failed: ${run.error ?? run.stderr}`,
        );
      }
      const { tasks } = summarySchema.parse(
        JSON.parse(run.stdout.slice(run.stdout.indexOf('{'))),
      );
      return new Map(tasks.map((task) => [task.taskId, task.hash]));
    };
    const before = hashes();
    write('packages/source/source.json', { value: 'after' });
    const after = hashes();
    for (const task of [...CHECK_TASKS, 'build']) {
      const consumer = `@cache/consumer#${task}`;
      const unrelated = `@cache/unrelated#${task}`;
      expect(before.has(consumer)).toBe(true);
      expect(after.get(consumer), consumer).not.toBe(before.get(consumer));
      expect(before.has(unrelated)).toBe(true);
      expect(after.get(unrelated), unrelated).toBe(before.get(unrelated));
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}, 60_000);

const setupAction = () =>
  z
    .object({
      inputs: z.record(z.string(), z.unknown()),
      runs: z.object({
        steps: z.array(
          z.object({
            name: z.string(),
            id: z.string().optional(),
            if: z.string().optional(),
            uses: z.string().optional(),
            run: z.string().optional(),
            with: z.record(z.string(), z.unknown()).optional(),
          }),
        ),
      }),
    })
    .parse(
      parse(
        readFileSync(
          join(REPO_ROOT, '.github/actions/setup-turbo/action.yml'),
          'utf8',
        ),
      ),
    );

test('Turbo uses one native branch-scoped cache archive with distinct workflow writers', () => {
  const action = setupAction();
  const cache = action.runs.steps.find(
    (step) => step.name === 'Restore Turbo task cache',
  )!;
  expect(cache.uses).toMatch(/^actions\/cache@[a-f0-9]{40}$/);
  expect(cache.if).toBe("inputs.turbo-cache == 'true'");
  expect(cache.with?.path).toBe('.turbo/cache');
  const prefix =
    "turbo-v1-${{ runner.os }}-${{ runner.arch }}-${{ inputs.bun-version }}-${{ inputs.cache-scope || github.job }}-${{ hashFiles('bun.lock') }}-";
  const source = '${{ steps.cache-source.outputs.revision }}';
  expect(cache.with?.key).toBe(`${prefix}${source}-\${{ github.workflow }}`);
  expect(cache.with?.['restore-keys']).toBe(`${prefix}${source}-\n${prefix}\n`);
  expect(
    action.runs.steps.some((step) =>
      step.uses?.includes('turborepo-gh-artifacts'),
    ),
  ).toBe(false);
  expect(
    action.runs.steps.find((step) => step.name === 'Install JS dependencies')
      ?.run,
  ).toBe('bun install --frozen-lockfile');
});

test('candidate cache keys use checked-out C rather than workflow head H, and disable remote activity', () => {
  const action = setupAction();
  const source = action.runs.steps.find((step) => step.id === 'cache-source')!;
  const environment = action.runs.steps.find(
    (step) => step.name === 'Disable third-party telemetry',
  )!;
  const fixture = mkdtempSync(join(tmpdir(), 'tale-cache-action-'));
  const output = join(fixture, 'outputs');
  const envFile = join(fixture, 'env');
  try {
    const run = spawnSync('bash', ['-c', `${environment.run}\n${source.run}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        GITHUB_ENV: envFile,
        GITHUB_SHA: '0'.repeat(40),
      },
    });
    expect(run.status, run.stderr).toBe(0);
    const checkout = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(readFileSync(output, 'utf8')).toBe(
      `revision=${checkout.stdout.trim()}\n`,
    );
    expect(readFileSync(envFile, 'utf8').split('\n')).toContain(
      'TURBO_CACHE=local:rw',
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('native cache callers use valid inputs and isolate active matrix task lanes', () => {
  const action = setupAction();
  const inputs = new Set(Object.keys(action.inputs));
  expect(JSON.stringify(action.runs)).not.toContain('inputs.github-token');
  expect(JSON.stringify(action.runs)).not.toContain('inputs.start-turbo-cache');
  const workflowSchema = z.object({
    jobs: z.record(
      z.string(),
      z.object({
        strategy: z.unknown().optional(),
        steps: z
          .array(
            z.object({
              uses: z.string().optional(),
              with: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .default([]),
      }),
    ),
  });
  for (const name of ['checks', 'e2e', 'build', 'commitlint']) {
    const file = readFileSync(
      join(REPO_ROOT, `.github/workflows/${name}.yml`),
      'utf8',
    );
    expect(file).not.toMatch(/TURBO_(?:API|TOKEN|TEAM):/);
    const workflow = workflowSchema.parse(parse(file));
    for (const [id, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.uses !== './.github/actions/setup-turbo') continue;
        // Workflow H can load the old action API from candidate C. That
        // implementation must install dependencies without starting its
        // repository-wide artifact server, even when new native caching is on.
        expect(step.with?.['start-turbo-cache'], `${name}/${id}`).toBe('false');
        expect(step.with?.['github-token'], `${name}/${id}`).toBe(
          '${{ secrets.GITHUB_TOKEN }}',
        );
        for (const input of Object.keys(step.with ?? {})) {
          expect(
            inputs.has(input),
            `${name}/${id} passes unknown ${input}`,
          ).toBe(true);
        }
        if (step.with?.['turbo-cache'] !== 'false' && job.strategy) {
          expect(
            step.with?.['cache-scope'],
            `${name}/${id} needs a matrix-specific lane`,
          ).toMatch(/matrix\./);
        }
      }
    }
  }
});

// Explicit outside-workspace globs include Git-ignored files unless they are
// excluded. A catalog skill's own Turbo log must not invalidate another task.
test('catalog build and generation hashes ignore task logs but retain source edits', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'tale-catalog-cache-'));
  const write = (file: string, value: string) => {
    const target = join(fixture, file);
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, value);
  };
  const readers = [
    '@tale/platform#build',
    '@tale/cli#generate',
    '@tale/cli#setup',
  ];
  const hashes = () => {
    const run = spawnSync(
      process.execPath,
      [
        'x',
        'turbo',
        'run',
        'build',
        'generate',
        'setup',
        `--cwd=${fixture}`,
        '--dry=json',
        '--cache=local:,remote:',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    if (run.status !== 0) {
      throw new Error(
        `catalog fixture dry run failed: ${run.error ?? run.stderr}`,
      );
    }
    const { tasks } = summarySchema.parse(
      JSON.parse(run.stdout.slice(run.stdout.indexOf('{'))),
    );
    return Object.fromEntries(
      readers.map((id) => {
        const task = tasks.find((entry) => entry.taskId === id);
        if (!task) throw new Error(`Missing catalog reader ${id}`);
        return [id, { hash: task.hash, inputs: task.inputs }];
      }),
    );
  };
  try {
    const config = z
      .object({ tasks: z.record(z.string(), z.unknown()) })
      .passthrough()
      .parse(JSON.parse(readFileSync(join(REPO_ROOT, 'turbo.json'), 'utf8')));
    config.tasks = Object.fromEntries(
      Object.entries(config.tasks).filter(
        ([name]) => !name.includes('#') || name.startsWith('@tale/cli#'),
      ),
    );
    write('turbo.json', JSON.stringify(config));
    const { packageManager } = z
      .object({ packageManager: z.string() })
      .parse(JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')));
    write(
      'package.json',
      JSON.stringify({
        name: 'catalog-cache-proof',
        private: true,
        packageManager,
        workspaces: ['services/*', 'tools/*'],
      }),
    );
    for (const [directory, name] of [
      ['services/platform', '@tale/platform'],
      ['tools/cli', '@tale/cli'],
    ]) {
      write(
        `${directory}/package.json`,
        JSON.stringify({
          name,
          scripts: {
            build: 'echo unused',
            generate: 'echo unused',
            setup: 'echo unused',
          },
        }),
      );
      write(
        `${directory}/turbo.json`,
        readFileSync(join(REPO_ROOT, directory!, 'turbo.json'), 'utf8'),
      );
    }
    write('.gitignore', '.turbo\n');
    const catalog = 'configs/platform/system/connectors/example/connector.yml';
    const skill = 'configs/platform/custom/skills/example/analyze.ts';
    const log = 'configs/platform/custom/skills/example/.turbo/turbo-test.log';
    write(catalog, 'name: original\n');
    write(skill, 'export const version = 1;\n');
    for (const args of [
      ['init', '--quiet'],
      ['add', '.'],
    ]) {
      const git = spawnSync('git', args, { cwd: fixture, encoding: 'utf8' });
      expect(git.status, git.stderr).toBe(0);
    }
    const baseline = hashes();
    for (const reader of readers) {
      expect(baseline[reader]!.inputs[`../../${catalog}`]).toBeDefined();
      expect(baseline[reader]!.inputs[`../../${skill}`]).toBeDefined();
    }
    write(log, 'test pass\n');
    const ignored = spawnSync('git', ['check-ignore', '--', log], {
      cwd: fixture,
      encoding: 'utf8',
    });
    expect(ignored.stdout).toBe(`${log}\n`);
    expect(hashes()).toEqual(baseline);
    write(log, 'different test output\n');
    expect(hashes()).toEqual(baseline);
    write(catalog, 'name: changed\n');
    const changedCatalog = hashes();
    for (const reader of readers)
      expect(changedCatalog[reader]!.hash).not.toBe(baseline[reader]!.hash);
    write(catalog, 'name: original\n');
    expect(hashes()).toEqual(baseline);
    write(skill, 'export const version = 2;\n');
    const changedSkill = hashes();
    for (const reader of readers)
      expect(changedSkill[reader]!.hash).not.toBe(baseline[reader]!.hash);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}, 60_000);
