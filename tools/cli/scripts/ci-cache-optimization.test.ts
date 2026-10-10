import { beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
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

const posixPath = (file: string) => file.replaceAll('\\', '/');

function repoInputs(task: Task): Set<string> {
  return new Set(
    Object.keys(task.inputs).map((file) =>
      posixPath(
        relative(
          REPO_ROOT,
          resolve(REPO_ROOT, posixPath(task.directory), posixPath(file)),
        ),
      ),
    ),
  );
}

/** Checks may reach package sources through their own transit task, which
 * also hashes outside-workspace CLI sources. Follow the actual dependency
 * graph instead of requiring only direct `^transit` edges. */
function dependencyClosure(task: Task, tasks: Map<string, Task>): Set<string> {
  const dependencies = new Set<string>();
  const queue = [...task.dependencies];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || dependencies.has(id)) continue;
    dependencies.add(id);
    const dependency = tasks.get(id);
    if (!dependency) throw new Error(`Turbo did not describe ${id}`);
    queue.push(...dependency.dependencies);
  }
  return dependencies;
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
        'setup',
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

  test('transit remains a no-command node across every declared workspace', () => {
    const { workspaces } = z
      .object({ workspaces: z.array(z.string()) })
      .parse(JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')));
    for (const workspace of workspaces) {
      for (const file of new Bun.Glob(`${workspace}/package.json`).scanSync({
        cwd: REPO_ROOT,
        absolute: true,
        onlyFiles: true,
      })) {
        const manifest = z
          .object({ scripts: z.record(z.string(), z.string()).optional() })
          .parse(JSON.parse(readFileSync(file, 'utf8')));
        expect(manifest.scripts?.transit, file).toBeUndefined();
      }
    }
  });

  test('ordinary checks skip empty setup tasks while real workspace setup stays explicit', () => {
    const configSchema = z.object({
      tasks: z.record(
        z.string(),
        z.object({ dependsOn: z.array(z.string()).optional() }),
      ),
    });
    const config = configSchema.parse(
      JSON.parse(readFileSync(join(REPO_ROOT, 'turbo.json'), 'utf8')),
    );
    const ordinary = [
      'lint',
      'lint:fix',
      'format',
      'format:check',
      'test',
      'test:watch',
      'test:coverage',
    ];
    for (const task of ordinary)
      expect(config.tasks[task]?.dependsOn ?? [], task).not.toContain('setup');
    expect(config.tasks.dev?.dependsOn).toContain('setup');
    const { workspaces } = z
      .object({ workspaces: z.array(z.string()) })
      .parse(JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')));
    for (const pattern of workspaces) {
      for (const file of new Bun.Glob(`${pattern}/package.json`).scanSync({
        cwd: REPO_ROOT,
        absolute: true,
        onlyFiles: true,
      })) {
        const workspace = z
          .object({
            name: z.string(),
            scripts: z.record(z.string(), z.string()).optional(),
          })
          .parse(JSON.parse(readFileSync(file, 'utf8')));
        const setup = workspace.scripts?.setup;
        if (!setup) continue;
        const localPath = join(dirname(file), 'turbo.json');
        const local: z.infer<typeof configSchema> = existsSync(localPath)
          ? configSchema.parse(JSON.parse(readFileSync(localPath, 'utf8')))
          : { tasks: {} };
        for (const task of ordinary) {
          if (!workspace.scripts?.[task]) continue;
          const dependencies =
            local.tasks[task]?.dependsOn ??
            config.tasks[`${workspace.name}#${task}`]?.dependsOn ??
            config.tasks[task]?.dependsOn ??
            [];
          if (/^echo '[^']*'$/.test(setup.trim())) {
            expect(dependencies, `${file}: ${task}`).not.toContain('setup');
          } else if (workspace.name === '@tale/cli') {
            expect(setup).toBe('bun run generate');
            // Format checks do not read the generated, ignored files.
            if (!task.startsWith('format')) {
              expect(dependencies, `${file}: ${task}`).toContain('generate');
              expect(dependencies, `${file}: ${task}`).not.toContain('setup');
            }
          } else {
            expect(
              dependencies,
              `${file}: attach real setup to this workspace's ${task}`,
            ).toContain('setup');
          }
        }
      }
    }
  });

  test('dependency sources invalidate checks without scheduling dependency checks', () => {
    const ownInputs = repoInputs(tasks.get('@tale/cli#test')!);
    for (const task of summary.tasks) {
      if (
        !CHECK_TASKS.includes(task.task) ||
        task.command === '<NONEXISTENT>'
      ) {
        continue;
      }
      const reachable = dependencyClosure(task, tasks);
      // Check the whole prerequisite closure, not just direct edges: a
      // dependency setup must not indirectly serialize executable checks.
      expect(
        [...reachable].filter((dependency) =>
          dependency.endsWith(`#${task.task}`),
        ),
        `${task.taskId} remains parallel to every dependency's checks`,
      ).toEqual([]);
      const directory = posixPath(task.directory);
      expect(
        ownInputs.has(`${directory}/package.json`),
        `CLI cache guard reads ${directory}/package.json`,
      ).toBe(true);
      const manifest = z
        .object({
          dependencies: z.record(z.string(), z.string()).optional(),
          devDependencies: z.record(z.string(), z.string()).optional(),
        })
        .parse(
          JSON.parse(
            readFileSync(join(REPO_ROOT, directory, 'package.json'), 'utf8'),
          ),
        );
      const dependencies = Object.entries({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      })
        .filter(([, version]) => version.startsWith('workspace:'))
        .map(([name]) => name);
      for (const dependency of dependencies) {
        expect(reachable, task.taskId).toContain(`${dependency}#transit`);
        const transit = tasks.get(`${dependency}#transit`)!;
        expect(transit.command, transit.taskId).toBe('<NONEXISTENT>');
        expect(
          Object.keys(transit.inputs).length,
          transit.taskId,
        ).toBeGreaterThan(1);
        expect(
          [...reachable].filter((id) => id === `${dependency}#${task.task}`),
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

  test('Windows Turbo directory and input paths resolve to the same repository keys', () => {
    const task = tasks.get('@tale/cli#test')!;
    const windowsTask = {
      ...task,
      directory: posixPath(task.directory).replaceAll('/', '\\'),
      inputs: Object.fromEntries(
        Object.entries(task.inputs).map(([file, hash]) => [
          posixPath(file).replaceAll('/', '\\'),
          hash,
        ]),
      ),
    };
    expect(repoInputs(windowsTask)).toEqual(repoInputs(task));
  });

  test('every root TypeScript family config contributes to task hashes', () => {
    const configs = readdirSync(REPO_ROOT).filter((name) =>
      /^tsconfig.*\.json$/.test(name),
    );
    expect(configs.length).toBeGreaterThan(1);
    for (const config of [...configs, 'bunfig.toml']) {
      expect(Object.keys(summary.globalCacheInputs.files)).toContain(config);
    }
  });

  test('installation settings and dependency patch contents invalidate shared task caches', () => {
    const files = new Set(
      Object.keys(summary.globalCacheInputs.files).map(posixPath),
    );
    expect(files).toContain('bunfig.toml');
    const patches = Array.from(
      new Bun.Glob('patches/**').scanSync({ cwd: REPO_ROOT, onlyFiles: true }),
    );
    expect(patches.length).toBeGreaterThan(0);
    for (const patch of patches) expect(files).toContain(posixPath(patch));
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
    expect(catalogs.filter((file) => !inputs.has(posixPath(file)))).toEqual([]);
    expect(task.dependencies).toContain('@tale/ui#build');
    expect(task.dependencies).toContain('@tale/shared#build');
    for (const source of [
      'services/platform/index.html',
      'services/platform/vite.config.ts',
      'services/platform/vite-plugins/inject-boot-shell.ts',
      'services/platform/scripts/prerender-boot-shell.tsx',
      'services/platform/scripts/check-entry-budget.ts',
    ])
      expect(inputs, source).toContain(source);
    expect(repoInputs(tasks.get('@tale/ui#build')!)).toContain(
      'packages/ui/tailwind-preset.ts',
    );
    expect(repoInputs(tasks.get('@tale/shared#build')!)).toContain(
      'packages/shared/package.json',
    );
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

test('component hashes reuse unrelated backend edits and invalidate imported policies', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'tale-component-inputs-'));
  const write = (path: string, content: string) => {
    const file = join(fixture, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  try {
    const config = z
      .object({ tasks: z.record(z.string(), z.unknown()) })
      .passthrough()
      .parse(JSON.parse(readFileSync(join(REPO_ROOT, 'turbo.json'), 'utf8')));
    config.tasks = Object.fromEntries(
      Object.entries(config.tasks).filter(([name]) => !name.includes('#')),
    );
    write('turbo.json', JSON.stringify(config));
    write(
      'package.json',
      JSON.stringify({
        name: 'component-input-fixture',
        private: true,
        packageManager: 'bun@1.4.2',
        workspaces: ['services/*'],
      }),
    );
    write(
      'services/platform/package.json',
      JSON.stringify({
        name: '@tale/platform',
        scripts: {
          'test:ui': 'echo never executed',
          'test:browser': 'echo never executed',
        },
      }),
    );
    write(
      'services/platform/turbo.json',
      readFileSync(join(REPO_ROOT, 'services/platform/turbo.json'), 'utf8'),
    );
    const unrelated = 'services/platform/backend/domains/chat/runtime.ts';
    const policies = [
      'services/platform/backend/core/tasks/helpers.ts',
      'services/platform/backend/domains/tasks/task-writer.ts',
    ];
    const original = 'export const version = 1;\n';
    const changed = 'export const version = 2;\n';
    for (const file of [unrelated, ...policies]) write(file, original);
    const install = spawnSync(
      process.execPath,
      ['install', '--lockfile-only', '--ignore-scripts'],
      { cwd: fixture, encoding: 'utf8' },
    );
    expect(install.status, install.stderr).toBe(0);
    const snapshots = () => {
      const run = spawnSync(
        process.execPath,
        [
          'x',
          'turbo',
          'run',
          'test:ui',
          'test:browser',
          `--cwd=${fixture}`,
          '--dry=json',
          '--cache=local:,remote:',
        ],
        { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      );
      if (run.status !== 0)
        throw new Error(`component dry run failed: ${run.error ?? run.stderr}`);
      return summarySchema
        .parse(JSON.parse(run.stdout.slice(run.stdout.indexOf('{'))))
        .tasks.filter((task) => task.command !== '<NONEXISTENT>')
        .map(({ taskId, hash }) => ({ taskId, hash }));
    };
    const baseline = snapshots();
    expect(baseline.map(({ taskId }) => taskId).sort()).toEqual([
      '@tale/platform#test:browser',
      '@tale/platform#test:ui',
    ]);
    write(unrelated, changed);
    expect(snapshots()).toEqual(baseline);
    for (const file of policies) {
      write(file, changed);
      for (const task of snapshots())
        expect(task.hash, `${task.taskId}/${file}`).not.toBe(
          baseline.find((entry) => entry.taskId === task.taskId)?.hash,
        );
      write(file, original);
      expect(snapshots()).toEqual(baseline);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}, 30_000);

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
            env: z.record(z.string(), z.string()).optional(),
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

test('Bun download caches preserve frozen installs and save before later checks', () => {
  const steps = setupAction().runs.steps;
  const restoreIndex = steps.findIndex((step) => step.id === 'bun-cache');
  const installIndex = steps.findIndex(
    (step) => step.name === 'Install JS dependencies',
  );
  const saveIndex = steps.findIndex(
    (step) => step.name === 'Save Bun install cache',
  );
  expect(restoreIndex).toBeGreaterThan(-1);
  expect(installIndex).toBeGreaterThan(restoreIndex);
  expect(saveIndex).toBeGreaterThan(installIndex);
  const restore = steps[restoreIndex];
  const install = steps[installIndex];
  const save = steps[saveIndex];
  expect(restore.uses).toMatch(/^actions\/cache\/restore@[a-f0-9]{40}$/);
  expect(save.uses).toBe(restore.uses?.replace('/restore@', '/save@'));
  const prefix =
    'bun-install-${{ runner.os }}-${{ runner.arch }}-${{ inputs.bun-version }}-';
  expect(restore.with?.path).toBe('~/.bun/install/cache');
  const key = String(restore.with?.key);
  expect(key).toStartWith(prefix);
  const { workspaces } = z
    .object({ workspaces: z.array(z.string()) })
    .parse(JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')));
  for (const input of [
    'bun.lock',
    'package.json',
    'patches/**',
    'bunfig.toml',
    ...workspaces.map((workspace) => `${workspace}/package.json`),
  ])
    expect(key, input).toContain(`'${input}'`);
  expect(restore.with?.['restore-keys']).toBe(`${prefix}\n`);
  expect(restore.env?.SEGMENT_DOWNLOAD_TIMEOUT_MINS).toBe('2');
  expect(install.run).toBe('bun install --frozen-lockfile');
  expect(install.if).toBeUndefined();
  // A normal step inherits success(), so only a successful frozen install
  // saves. Save downloads before later workload failures suppress post steps.
  expect(save.if).toBe("steps.bun-cache.outputs.cache-hit != 'true'");
  expect(save.with).toEqual({
    path: '~/.bun/install/cache',
    key: '${{ steps.bun-cache.outputs.cache-primary-key }}',
  });
  expect(saveIndex).toBeLessThan(
    steps.findIndex(
      (step) => step.name === 'Identify the checked-out cache source',
    ),
  );
});

test('native CLI and shared Bun downloads render one canonical dependency identity', () => {
  const shared = setupAction().runs.steps.find(
    (step) => step.id === 'bun-cache',
  )!;
  const cli = z
    .object({
      jobs: z.object({
        build: z.object({
          steps: z.array(
            z.object({
              id: z.string().optional(),
              with: z.record(z.string(), z.unknown()).optional(),
            }),
          ),
        }),
      }),
    })
    .parse(
      parse(readFileSync(join(REPO_ROOT, '.github/workflows/cli.yml'), 'utf8')),
    )
    .jobs.build.steps.find((step) => step.id === 'bun-cache')!;
  const { workspaces, packageManager } = z
    .object({ workspaces: z.array(z.string()), packageManager: z.string() })
    .parse(JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')));
  const bunVersion = packageManager.replace(/^bun@/, '');
  const canonical = [
    'bun.lock',
    'package.json',
    ...workspaces.map((workspace) => `${workspace}/package.json`),
    'patches/**',
    'bunfig.toml',
  ];
  const patterns = (expression: string) => {
    const argumentsText = expression.match(/hashFiles\(([^)]+)\)/)?.[1];
    expect(argumentsText).toBeDefined();
    const inputs = [...argumentsText!.matchAll(/'([^']+)'/g)].map(
      (match) => match[1]!,
    );
    expect(argumentsText).toBe(inputs.map((input) => `'${input}'`).join(', '));
    return inputs;
  };
  const sharedKey = z.string().parse(shared.with?.key);
  const cliKey = z.string().parse(cli.with?.key);
  expect(patterns(sharedKey)).toEqual(canonical);
  expect(patterns(cliKey)).toEqual(canonical);
  const fixture = mkdtempSync(join(tmpdir(), 'tale-bun-key-'));
  try {
    const files = [
      ...new Set(
        canonical.flatMap((pattern) =>
          Array.from(
            new Bun.Glob(pattern).scanSync({
              cwd: REPO_ROOT,
              onlyFiles: true,
            }),
          ),
        ),
      ),
    ].sort();
    const independent = 'services/sandbox-runtime/document-node/package.json';
    expect(files).not.toContain(independent);
    for (const file of [...files, independent]) {
      mkdirSync(dirname(join(fixture, file)), { recursive: true });
      writeFileSync(join(fixture, file), readFileSync(join(REPO_ROOT, file)));
    }
    const render = (
      template: string,
      os = 'Linux',
      arch = 'X64',
      cross = false,
      version = bunVersion,
    ) =>
      template.replace(/\$\{\{\s*([^}]+)\}\}/g, (_match, source: string) => {
        const expression = source.trim();
        if (expression.startsWith('hashFiles(')) {
          const matched = [
            ...new Set(
              patterns(expression).flatMap((pattern) =>
                Array.from(
                  new Bun.Glob(pattern).scanSync({
                    cwd: fixture,
                    onlyFiles: true,
                  }),
                ),
              ),
            ),
          ].sort();
          const hash = createHash('sha256');
          for (const file of matched)
            hash.update(
              createHash('sha256')
                .update(readFileSync(join(fixture, file)))
                .digest(),
            );
          return matched.length > 0 ? hash.digest('hex') : '';
        }
        const values: Record<string, string> = {
          'runner.os': os,
          'runner.arch': arch,
          'inputs.bun-version': version,
          "matrix.cross && 'bun-cli-install' || 'bun-install'": cross
            ? 'bun-cli-install'
            : 'bun-install',
        };
        const value = values[expression];
        if (value === undefined)
          throw new Error(`Unrecognized Bun cache expression: ${expression}`);
        return value;
      });
    const identities = [
      ['Linux', 'X64'],
      ['Linux', 'ARM64'],
      ['macOS', 'X64'],
      ['macOS', 'ARM64'],
      ['Windows', 'X64'],
    ];
    for (const [os, arch] of identities) {
      expect(render(cliKey, os, arch)).toBe(render(sharedKey, os, arch));
      expect(render(String(cli.with?.['restore-keys']), os, arch)).toBe(
        render(String(shared.with?.['restore-keys']), os, arch),
      );
    }
    expect(
      new Set(identities.map(([os, arch]) => render(cliKey, os, arch))).size,
    ).toBe(identities.length);
    expect(
      render(sharedKey, 'Linux', 'X64', false, `${bunVersion}-other`),
    ).not.toBe(render(cliKey));
    expect(render(cliKey, 'Linux', 'X64', true)).toBe(
      render(cliKey).replace(/^bun-install-/, 'bun-cli-install-'),
    );
    const snapshot = () => [render(sharedKey), render(cliKey)];
    const baseline = snapshot();
    for (const file of files) {
      const original = readFileSync(join(fixture, file));
      writeFileSync(
        join(fixture, file),
        Buffer.concat([original, Buffer.from('\nchanged\n')]),
      );
      const changed = snapshot();
      expect(changed[0], file).not.toBe(baseline[0]);
      expect(changed[1], file).toBe(changed[0]);
      writeFileSync(join(fixture, file), original);
      expect(snapshot(), file).toEqual(baseline);
    }
    writeFileSync(join(fixture, independent), '{}\n');
    expect(snapshot()).toEqual(baseline);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('Turbo uses one native branch-scoped cache archive with distinct workflow writers', () => {
  const action = setupAction();
  const cache = action.runs.steps.find(
    (step) => step.name === 'Restore Turbo task cache',
  )!;
  expect(cache.uses).toMatch(/^actions\/cache@[a-f0-9]{40}$/);
  expect(cache.if).toBe("inputs.turbo-cache == 'true'");
  expect(cache.env?.SEGMENT_DOWNLOAD_TIMEOUT_MINS).toBe('2');
  expect(cache.with?.path).toBe('.turbo/cache');
  const prefix =
    "turbo-v1-${{ runner.os }}-${{ runner.arch }}-${{ inputs.bun-version }}-${{ inputs.cache-scope || github.job }}-${{ hashFiles('bun.lock') }}-";
  const source = '${{ steps.cache-source.outputs.revision }}';
  expect(cache.with?.key).toBe(
    `${prefix}${source}-\${{ github.workflow }}` +
      '-${{ inputs.cache-writer || github.job }}',
  );
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

test('shared setup pins the exact production Node and disables redundant npm caching', () => {
  const action = setupAction();
  const resolver = action.runs.steps.find((step) => step.id === 'node')!;
  const setup = action.runs.steps.find((step) => step.name === 'Setup Node')!;
  expect(setup.uses).toMatch(/^actions\/setup-node@[a-f0-9]{40}$/);
  expect(setup.with).toEqual({
    'node-version': '${{ steps.node.outputs.version }}',
    'package-manager-cache': false,
  });
  expect(action.runs.steps.indexOf(resolver)).toBeLessThan(
    action.runs.steps.indexOf(setup),
  );
  expect(action.runs.steps.indexOf(setup)).toBeLessThan(
    action.runs.steps.findIndex(
      (step) => step.name === 'Install JS dependencies',
    ),
  );
  const fixture = mkdtempSync(join(tmpdir(), 'tale-ci-node-pin-'));
  try {
    mkdirSync(join(fixture, 'services/platform'), { recursive: true });
    const output = join(fixture, 'output');
    const dockerfile = readFileSync(
      join(REPO_ROOT, 'services/platform/Dockerfile'),
      'utf8',
    );
    const version = dockerfile.match(
      /^FROM node:([\d.]+)-.* AS node-bin$/m,
    )?.[1];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const [source, expected] of [
      [dockerfile, version],
      ['FROM node:22.21.1-bookworm-slim AS node-bin\n', '22.21.1'],
      ['FROM node:latest AS node-bin\n', undefined],
      ['FROM node:22-bookworm-slim AS node-bin\n', undefined],
      [
        'FROM node:22.21.1-bookworm-slim AS node-bin\nFROM node:22.21.2-bookworm-slim AS node-bin\n',
        undefined,
      ],
      ['', undefined],
    ] as const) {
      writeFileSync(join(fixture, 'services/platform/Dockerfile'), source);
      writeFileSync(output, '');
      const result = spawnSync('bash', ['-c', resolver.run!], {
        cwd: fixture,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: output },
      });
      expect(result.status, result.stderr + result.stdout).toBe(
        expected ? 0 : 1,
      );
      expect(readFileSync(output, 'utf8')).toBe(
        expected ? `version=${expected}\n` : '',
      );
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('actual Bun, Node and runner identity reach Turbo hashes while telemetry remains disabled', () => {
  const action = setupAction();
  const identify = action.runs.steps.find(
    (step) => step.name === 'Identify the actual task runtime',
  )!;
  const telemetry = action.runs.steps.find(
    (step) => step.name === 'Disable third-party telemetry',
  )!;
  const fixture = mkdtempSync(join(tmpdir(), 'tale-ci-runtime-'));
  const environment = join(fixture, 'env');
  try {
    const result = spawnSync(
      'bash',
      ['-c', `${telemetry.run}\n${identify.run}`],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          RUNNER_OS: 'Linux',
          RUNNER_ARCH: 'X64',
          GITHUB_ENV: environment,
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const values = readFileSync(environment, 'utf8').split('\n');
    const runtime = values.find((value) =>
      value.startsWith('TALE_CI_RUNTIME='),
    );
    expect(runtime).toStartWith('TALE_CI_RUNTIME=Linux-X64-');
    expect(runtime).toContain(
      spawnSync('node', ['--version'], { encoding: 'utf8' }).stdout.trim(),
    );
    expect(runtime).toEndWith(
      spawnSync('bun', ['--version'], { encoding: 'utf8' }).stdout.trim(),
    );
    expect(values).toContain('TELEMETRY_DISABLED=1');
    const config = z
      .object({ globalEnv: z.array(z.string()) })
      .parse(JSON.parse(readFileSync(join(REPO_ROOT, 'turbo.json'), 'utf8')));
    expect(config.globalEnv).toContain('TALE_CI_RUNTIME');
    const hashes: string[][] = [];
    for (const identity of [
      'Linux-X64-ubuntu-24.04-v22.21.1-1.4.2',
      'Linux-X64-ubuntu-24.04-v22.21.2-1.4.2',
      'Linux-X64-ubuntu-24.04-v22.21.1-1.4.3',
      'Linux-X64-ubuntu-26.04-v22.21.1-1.4.2',
    ]) {
      const dry = spawnSync(
        process.execPath,
        [
          'x',
          'turbo',
          'run',
          'lint',
          '--filter=@tale/shared',
          '--dry=json',
          '--cache=local:,remote:',
        ],
        {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, TALE_CI_RUNTIME: identity },
        },
      );
      expect(dry.status, dry.stderr).toBe(0);
      const tasks = summarySchema.parse(JSON.parse(dry.stdout)).tasks;
      expect(tasks.length).toBeGreaterThan(0);
      hashes.push(
        tasks.map((task) => `${task.taskId}=${task.hash}`).toSorted(),
      );
    }
    expect(new Set(hashes.map((hash) => JSON.stringify(hash))).size).toBe(
      hashes.length,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('build archive writers share restore prefixes without sharing immutable keys', () => {
  const action = setupAction();
  expect(action.inputs['cache-writer']).toMatchObject({ default: '' });
  const cache = action.runs.steps.find(
    (step) => step.name === 'Restore Turbo task cache',
  )!;
  const key = z.string().parse(cache.with?.key);
  const restore = z.string().parse(cache.with?.['restore-keys']);
  const source = 'a'.repeat(40);
  function identity(
    workflow: string,
    job: string,
    writer = '',
    scope = 'build',
  ) {
    const expressions: Record<string, string> = {
      'runner.os': 'Linux',
      'runner.arch': 'X64',
      'inputs.bun-version': '1.4.2',
      'inputs.cache-scope || github.job': scope || job,
      "hashFiles('bun.lock')": 'lockfile-hash',
      'steps.cache-source.outputs.revision': source,
      'github.workflow': workflow,
      'inputs.cache-writer || github.job': writer || job,
    };
    const render = (template: string) =>
      template.replace(
        /\$\{\{\s*([^}]+)\}\}/g,
        (_match, expression: string) => {
          const value = expressions[expression.trim()];
          if (value === undefined)
            throw new Error(`Unrecognized cache expression: ${expression}`);
          return value;
        },
      );
    return {
      key: render(key),
      prefixes: render(restore).trim().split('\n'),
    };
  }
  const identities = [
    identity('Checks', 'build'),
    identity('E2E', 'build'),
    identity('E2E', 'static-sites', 'static-web'),
    identity('E2E', 'static-sites', 'static-docs'),
  ];
  expect(new Set(identities.map((entry) => entry.key)).size).toBe(4);
  for (const entry of identities) {
    expect(entry.prefixes).toEqual(identities[0]!.prefixes);
    for (const other of identities)
      expect(other.key.startsWith(entry.prefixes[0]!)).toBe(true);
    const previousSource = entry.key.replace(source, 'b'.repeat(40));
    expect(previousSource.startsWith(entry.prefixes[0]!)).toBe(false);
    expect(previousSource.startsWith(entry.prefixes[1]!)).toBe(true);
  }
  const otherLane = identity('Checks', 'test', '', 'test');
  for (const entry of identities)
    expect(otherLane.key.startsWith(entry.prefixes[1]!)).toBe(false);
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
            ['cache-scope', 'cache-writer'].some((input) => {
              const value = step.with?.[input];
              return typeof value === 'string' && /matrix\./.test(value);
            }),
            `${name}/${id} needs a matrix-specific cache scope or writer`,
          ).toBe(true);
        }
      }
    }
  }
});

// Explicit outside-workspace globs include Git-ignored files unless they are
// excluded. Skill logs and incremental compiler outputs are local state;
// dependency patches and shared toolchain inputs must invalidate every reader.
test('catalog readers ignore local artifacts but retain source and toolchain edits', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'tale-catalog-cache-'));
  const write = (file: string, value: string) => {
    const target = join(fixture, file);
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, value);
  };
  const readers = [
    '@tale/platform#build',
    '@tale/platform#test',
    '@tale/cli#generate',
    '@tale/cli#setup',
    '@tale/cli#test',
    '@tale/cli#transit',
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
        'test',
        'transit',
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
        return [
          id,
          {
            hash: task.hash,
            inputs: Object.fromEntries(
              Object.entries(task.inputs).map(([file, hash]) => [
                posixPath(file),
                hash,
              ]),
            ),
          },
        ];
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
            test: 'echo unused',
          },
        }),
      );
      write(
        `${directory}/turbo.json`,
        readFileSync(join(REPO_ROOT, directory, 'turbo.json'), 'utf8'),
      );
    }
    write('.gitignore', '.turbo\n*.tsbuildinfo\n');
    const catalog = 'configs/platform/system/connectors/example/connector.yml';
    const skill = 'configs/platform/custom/skills/example/analyze.ts';
    const log = 'configs/platform/custom/skills/example/.turbo/turbo-test.log';
    const incremental =
      'configs/platform/custom/skills/example/tsconfig.tsbuildinfo';
    const globalInputs = {
      'patches/postgres@3.4.7.patch': 'fixture patch\n',
      'tsconfig.dom.json': '{"compilerOptions":{"lib":["DOM"]}}\n',
      '.github/actions/setup-turbo/action.yml': 'name: fixture toolchain\n',
    };
    write(catalog, 'name: original\n');
    write(skill, 'export const version = 1;\n');
    for (const [file, contents] of Object.entries(globalInputs))
      write(file, contents);
    for (const args of [
      ['init', '--quiet'],
      ['add', '.'],
    ]) {
      const git = spawnSync('git', args, { cwd: fixture, encoding: 'utf8' });
      expect(git.status, git.stderr).toBe(0);
    }
    const baseline = hashes();
    for (const reader of readers) {
      expect(baseline[reader].inputs[`../../${catalog}`]).toBeDefined();
      expect(baseline[reader].inputs[`../../${skill}`]).toBeDefined();
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
    // tsc --noEmit still writes incremental output. Catalog consumers and
    // CLI embedding never read it; creation and rewrites keep their verdicts.
    for (const contents of [
      '{"version":"6.0.2"}\n',
      '{"version":"6.0.2","fileNames":["./src/analyze.ts"]}\n',
    ]) {
      write(incremental, contents);
      const ignoredIncremental = spawnSync(
        'git',
        ['check-ignore', '--', incremental],
        { cwd: fixture, encoding: 'utf8' },
      );
      expect(ignoredIncremental.stdout).toBe(incremental + '\n');
      expect(hashes()).toEqual(baseline);
    }
    write(catalog, 'name: changed\n');
    const changedCatalog = hashes();
    for (const reader of readers) {
      expect(changedCatalog[reader].hash).not.toBe(baseline[reader].hash);
      expect(changedCatalog[reader].inputs[`../../${catalog}`]).not.toBe(
        baseline[reader].inputs[`../../${catalog}`],
      );
    }
    write(catalog, 'name: original\n');
    expect(hashes()).toEqual(baseline);
    write(skill, 'export const version = 2;\n');
    const changedSkill = hashes();
    for (const reader of readers) {
      expect(changedSkill[reader].hash).not.toBe(baseline[reader].hash);
      expect(changedSkill[reader].inputs[`../../${skill}`]).not.toBe(
        baseline[reader].inputs[`../../${skill}`],
      );
    }
    write(skill, 'export const version = 1;\n');
    expect(hashes()).toEqual(baseline);
    for (const [file, contents] of Object.entries(globalInputs)) {
      write(file, `${contents}\n`);
      const changed = hashes();
      for (const reader of readers)
        expect(changed[reader].hash, `${reader} hashes ${file}`).not.toBe(
          baseline[reader].hash,
        );
      write(file, contents);
      expect(hashes()).toEqual(baseline);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}, 60_000);
