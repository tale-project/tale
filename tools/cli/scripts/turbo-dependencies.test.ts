import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TURBO = join(ROOT, 'node_modules/turbo/bin/turbo');
const HASH_TASKS = [
  'lint',
  'typecheck',
  'test',
  'test:ui',
  'test:browser',
  'test:coverage',
  'storybook:build',
];
const ALL_TASKS = [...HASH_TASKS, 'build', 'test:prerender'];
const DOCUMENTATION_PACKAGES = ['ui', 'marketing-ui', 'e2e'];
const DAEMON_TASKS = ['lint', 'typecheck', 'test'];
const DAEMON_OUTSIDE_FILES = [
  'services/sandbox/src/session/runnerd-client.ts',
  'services/sandbox/src/session/runnerd-protocol.ts',
  'services/sandbox/src/operation-budget.ts',
];
const temporary: string[] = [];

const dryRunSchema = z.object({
  globalCacheInputs: z.object({
    files: z.record(z.string(), z.string()),
    hashOfInternalDependencies: z.string(),
  }),
  tasks: z.array(
    z.object({
      taskId: z.string(),
      task: z.string(),
      command: z.string(),
      hash: z.string(),
      dependencies: z.array(z.string()),
      inputs: z.record(z.string(), z.string()),
      resolvedTaskDefinition: z.object({ outputs: z.array(z.string()) }),
    }),
  ),
});
type Task = z.infer<typeof dryRunSchema>['tasks'][number];

afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}

function dryRun(cwd: string): z.infer<typeof dryRunSchema> {
  const stdout = run(
    process.execPath,
    [TURBO, 'run', ...ALL_TASKS, '--dry=json', '--cache=local:,remote:'],
    cwd,
  );
  return dryRunSchema.parse(JSON.parse(stdout.slice(stdout.indexOf('{'))));
}

function graph(cwd: string): Map<string, Task> {
  const { tasks } = dryRun(cwd);
  return new Map(tasks.map((task) => [task.taskId, task]));
}

/** Real production definitions, synthetic source graph, no dependency install.
 * The intermediate and leaf have no build scripts, as source-only packages do. */
async function fixture(includeDaemon = false): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tale-turbo-dependencies-'));
  temporary.push(directory);
  await writeFile(
    join(directory, 'turbo.json'),
    await readFile(join(ROOT, 'turbo.json')),
  );
  await writeFile(
    join(directory, 'tsconfig.base.json'),
    await readFile(join(ROOT, 'tsconfig.base.json')),
  );
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({
      name: 'cache-regression-fixture',
      private: true,
      packageManager: 'bun@1.4.2',
      // Root workspace dependencies participate in Turbo's global hash.
      devDependencies: { '@tale/shared': 'workspace:*' },
      workspaces: [
        'packages/*',
        ...(includeDaemon ? ['services/sandbox-runtime/daemon'] : []),
      ],
    }),
  );
  await writeFile(join(directory, '.gitignore'), '.turbo/\ndist/\n');
  for (const [name, dependencies] of [
    ['ui', {}],
    ['marketing-ui', { '@tale/ui': 'workspace:*' }],
    [
      'web',
      { '@tale/marketing-ui': 'workspace:*', '@tale/e2e': 'workspace:*' },
    ],
    ['shared', {}],
    ['e2e', {}],
    ['cli', { '@tale/shared': 'workspace:*' }],
    ['unrelated', {}],
    ['db', {}],
    ['proxy', {}],
  ] as const) {
    const workspace = join(directory, 'packages', name);
    await mkdir(workspace, { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: `@tale/${name}`,
        version: '0.0.0',
        dependencies,
        scripts: Object.fromEntries(
          [...ALL_TASKS, 'setup', 'generate']
            .filter(
              (task) =>
                (name !== 'ui' && name !== 'marketing-ui') || task !== 'build',
            )
            .map((task) => [task, 'echo fixture']),
        ),
      }),
    );
    await writeFile(join(workspace, 'source.ts'), 'export const value = 1;\n');
    await writeFile(join(workspace, 'catalog.yml'), 'label: First\n');
    if (DOCUMENTATION_PACKAGES.includes(name)) {
      const config = join(ROOT, 'packages', name, 'turbo.json');
      if (existsSync(config))
        await writeFile(join(workspace, 'turbo.json'), await readFile(config));
    }
    if (DOCUMENTATION_PACKAGES.includes(name) || name === 'shared')
      await writeFile(join(workspace, 'README.md'), `# ${name} package\n`);
    if (name === 'ui' || name === 'marketing-ui') {
      await writeFile(
        join(workspace, 'tailwind-preset.ts'),
        'export const theme = {};\n',
      );
    }
    if (name === 'cli')
      await writeFile(
        join(workspace, 'turbo.json'),
        await readFile(join(ROOT, 'tools/cli/turbo.json')),
      );
    if (name === 'web') {
      await writeFile(
        join(workspace, 'turbo.json'),
        await readFile(join(ROOT, 'services/web/turbo.json')),
      );
      const generated = join(workspace, 'app/generated');
      await mkdir(generated, { recursive: true });
      await writeFile(
        join(generated, 'releases-manifest.ts'),
        "export const RELEASES = [{ tag: 'v1.0.0' }];\n",
      );
    }
  }
  for (const [file, source] of [
    [
      'services/platform/backend/core/reference.ts',
      'export const value = 1;\n',
    ],
    ['services/platform/backend/auth/oidc.ts', 'export const value = 1;\n'],
    [
      'configs/platform/system/connectors/example/connector.yml',
      'name: example\n',
    ],
    ['services/platform/app/unrelated.ts', 'export const value = 1;\n'],
  ] as const) {
    const target = join(directory, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
  }
  if (includeDaemon) {
    const daemon = join(directory, 'services/sandbox-runtime/daemon');
    await mkdir(join(daemon, 'src'), { recursive: true });
    await writeFile(
      join(daemon, 'package.json'),
      JSON.stringify({
        name: '@tale/sandbox-runtime-daemon',
        version: '0.0.0',
        scripts: Object.fromEntries(
          [...DAEMON_TASKS, 'build'].map((name) => [name, 'echo fixture']),
        ),
      }),
    );
    await writeFile(
      join(daemon, 'turbo.json'),
      await readFile(join(ROOT, 'services/sandbox-runtime/daemon/turbo.json')),
    );
    await writeFile(join(daemon, 'src/main.ts'), 'export const value = 1;\n');
    for (const file of [
      ...DAEMON_OUTSIDE_FILES,
      'services/sandbox/src/unrelated.ts',
    ]) {
      const target = join(directory, file);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, 'export const value = 1;\n');
    }
  }
  run('git', ['init', '-q'], directory);
  run('git', ['add', '.'], directory);
  run(
    'git',
    [
      '-c',
      'user.name=Cache Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-qm',
      'baseline',
      '--no-gpg-sign',
      '--no-verify',
    ],
    directory,
  );
  return directory;
}

function getTask(tasks: Map<string, Task>, id: string): Task {
  const result = tasks.get(id);
  if (!result) throw new Error(`Turbo did not describe ${id}`);
  return result;
}

function prerequisites(task: Task, tasks: Map<string, Task>): Task[] {
  const reached = new Set<string>();
  const queue = [...task.dependencies];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || reached.has(id)) continue;
    reached.add(id);
    queue.push(...getTask(tasks, id).dependencies);
  }
  return [...reached].map((id) => getTask(tasks, id));
}

describe('dependency-aware Turbo cache', () => {
  let repository: z.infer<typeof dryRunSchema>;
  let tasks: Map<string, Task>;

  beforeAll(() => {
    repository = dryRun(ROOT);
    tasks = new Map(repository.tasks.map((entry) => [entry.taskId, entry]));
  }, 60_000);

  test('CLI acceptance fixtures hash the actual shared identity producer', () => {
    expect(
      getTask(tasks, '@tale/cli#transit').inputs[
        '../../packages/ui/src/server/serving-identity.ts'
      ],
    ).toBeDefined();
  });

  test('client builds and their regression guard hash the shared completion helper', () => {
    for (const service of [
      'platform',
      'web',
      'docs',
      'ui-docs',
      'ai-gateway',
    ]) {
      expect(
        getTask(tasks, `@tale/${service}#build`).inputs[
          '../../packages/ui/bin/build-client.ts'
        ],
        service,
      ).toBeDefined();
    }
    const inputs = getTask(tasks, '@tale/cli#test').inputs;
    for (const file of [
      'packages/ui/bin/build-client.ts',
      'services/ui-docs/playwright.config.ts',
      'services/platform/scripts/dev-engine.ts',
      'tools/plop/templates/service/react/Dockerfile.hbs',
      'tools/plop/templates/service/react/package.json.hbs',
    ]) {
      expect(
        inputs[
          relative(join(ROOT, 'tools/cli'), join(ROOT, file))
            .split(sep)
            .join('/')
        ],
        file,
      ).toBeDefined();
    }
  });

  test('every root compiler configuration participates in the global hash', async () => {
    const files = (await readdir(ROOT)).filter((name) =>
      /^tsconfig.*\.json$/.test(name),
    );
    expect(files.length).toBeGreaterThan(1);
    const hashed = repository.globalCacheInputs.files;
    expect(files.filter((file) => !hashed[file])).toEqual([]);
    expect(hashed['bunfig.toml']).toBeDefined();
  });

  test('source-consuming tasks retain parallel checks and CLI generation', () => {
    for (const entry of tasks.values()) {
      if (!HASH_TASKS.includes(entry.task) || entry.command === '<NONEXISTENT>')
        continue;
      const workspace = entry.taskId.split('#')[0];
      const closure = prerequisites(entry, tasks);
      expect(
        closure.filter(
          (dependency) =>
            !dependency.taskId.startsWith(`${workspace}#`) &&
            HASH_TASKS.includes(dependency.task) &&
            dependency.command !== '<NONEXISTENT>',
        ),
        entry.taskId,
      ).toEqual([]);
      for (const transit of closure.filter((task) => task.task === 'transit')) {
        expect(transit.command, transit.taskId).toBe('<NONEXISTENT>');
        expect(
          transit.dependencies.every((dependency) =>
            dependency.endsWith('#transit'),
          ),
          transit.taskId,
        ).toBe(true);
      }
    }
    // Generic checks hash their own effective inputs and reach upstream
    // sources. CLI checks also reach their own transit's external import inputs.
    for (const name of ['lint', 'typecheck', 'test']) {
      const task = getTask(tasks, `@tale/cli#${name}`);
      expect(task.dependencies, task.taskId).toContain('@tale/cli#generate');
      expect(task.dependencies, task.taskId).toContain('@tale/cli#transit');
    }
    // Covers a transitive dependency even though web also declares UI directly.
    expect(getTask(tasks, '@tale/marketing-ui#transit').dependencies).toContain(
      '@tale/ui#transit',
    );
  });

  test('direct and transitive source changes invalidate consumers, unrelated changes stay cached', async () => {
    const directory = await fixture();
    const baseline = graph(directory);
    await writeFile(
      join(directory, 'packages/ui/source.ts'),
      'export const value = 2;\n',
    );
    let leafChanged = graph(directory);
    for (const name of ALL_TASKS) {
      for (const consumer of ['marketing-ui', 'web']) {
        const id = `@tale/${consumer}#${name}`;
        expect(getTask(leafChanged, id).hash, id).not.toBe(
          getTask(baseline, id).hash,
        );
      }
      const unrelated = `@tale/unrelated#${name}`;
      expect(getTask(leafChanged, unrelated).hash, unrelated).toBe(
        getTask(baseline, unrelated).hash,
      );
    }
    await writeFile(
      join(directory, 'packages/ui/catalog.yml'),
      'label: Second\n',
    );
    const catalogChanged = graph(directory);
    for (const name of ALL_TASKS) {
      const id = `@tale/web#${name}`;
      expect(getTask(catalogChanged, id).hash, id).not.toBe(
        getTask(leafChanged, id).hash,
      );
    }
    leafChanged = catalogChanged;
    await writeFile(
      join(directory, 'packages/unrelated/source.ts'),
      'export const value = 3;\n',
    );
    const unrelatedChanged = graph(directory);
    for (const name of ALL_TASKS) {
      const id = `@tale/web#${name}`;
      expect(getTask(unrelatedChanged, id).hash, id).toBe(
        getTask(leafChanged, id).hash,
      );
    }
    await writeFile(
      join(directory, 'packages/shared/source.ts'),
      'export const value = 4;\n',
    );
    const sharedChanged = graph(directory);
    expect(getTask(sharedChanged, '@tale/cli#typecheck').hash).not.toBe(
      getTask(unrelatedChanged, '@tale/cli#typecheck').hash,
    );
  }, 60_000);

  for (const packageName of DOCUMENTATION_PACKAGES) {
    test(`${packageName} documentation preserves consumer checks while package checks, builds and publication stay current`, async () => {
      const directory = await fixture();
      const baseline = graph(directory);
      const config = z
        .object({
          tasks: z.object({
            transit: z.object({ inputs: z.array(z.string()) }),
          }),
        })
        .parse(
          JSON.parse(
            await readFile(
              join(directory, 'packages', packageName, 'turbo.json'),
              'utf8',
            ),
          ),
        );
      expect(config.tasks.transit.inputs.slice(0, 2)).toEqual([
        '$TURBO_EXTENDS$',
        '$TURBO_DEFAULT$',
      ]);
      const consumers =
        packageName === 'ui' ? ['marketing-ui', 'web'] : ['web'];
      const readme = join(directory, 'packages', packageName, 'README.md');
      const original = await readFile(readme, 'utf8');
      await writeFile(readme, `${original}\nUpdated installation guide.\n`);
      const documentationChanged = graph(directory);
      for (const name of HASH_TASKS) {
        for (const consumer of consumers) {
          const id = `@tale/${consumer}#${name}`;
          expect(getTask(documentationChanged, id).hash, id).toBe(
            getTask(baseline, id).hash,
          );
        }
        const own = `@tale/${packageName}#${name}`;
        expect(getTask(documentationChanged, own).hash, own).not.toBe(
          getTask(baseline, own).hash,
        );
      }
      for (const name of ['build', 'test:prerender']) {
        for (const consumer of consumers) {
          const id = `@tale/${consumer}#${name}`;
          expect(getTask(documentationChanged, id).hash, id).not.toBe(
            getTask(baseline, id).hash,
          );
        }
      }
      if (packageName === 'ui' || packageName === 'marketing-ui')
        expect(getTask(documentationChanged, '@tale/cli#test').hash).not.toBe(
          getTask(baseline, '@tale/cli#test').hash,
        );
      await writeFile(readme, original);
      expect(graph(directory)).toEqual(baseline);

      // Only documentation drops from transit: source, catalogs, the public
      // export map and exported files outside src remain dependencies.
      const files = ['source.ts', 'catalog.yml', 'package.json'];
      if (packageName === 'ui' || packageName === 'marketing-ui')
        files.push('tailwind-preset.ts');
      for (const file of files) {
        const target = join(directory, 'packages', packageName, file);
        const contents = await readFile(target, 'utf8');
        await writeFile(
          target,
          file === 'package.json'
            ? JSON.stringify({
                ...JSON.parse(contents),
                exports: { './source': './source.ts' },
              })
            : file === 'catalog.yml'
              ? `${contents}\nupdated: true\n`
              : `${contents}\nexport const accent = 'blue';\n`,
        );
        const changed = graph(directory);
        for (const name of ALL_TASKS) {
          for (const consumer of consumers) {
            const id = `@tale/${consumer}#${name}`;
            expect(getTask(changed, id).hash, `${id}: ${file}`).not.toBe(
              getTask(baseline, id).hash,
            );
          }
        }
        await writeFile(target, contents);
        expect(graph(directory)).toEqual(baseline);
      }
    }, 60_000);
  }

  test('package documentation boundaries retain compiler and root workspace dependency global hashes', async () => {
    const directory = await fixture();
    const baselineRun = dryRun(directory);
    const baseline = new Map(
      baselineRun.tasks.map((task) => [task.taskId, task]),
    );
    for (const file of ['tsconfig.base.json', 'packages/shared/README.md']) {
      const target = join(directory, file);
      const contents = await readFile(target, 'utf8');
      await writeFile(
        target,
        file.endsWith('.json')
          ? JSON.stringify({
              ...JSON.parse(contents),
              compilerOptions: {
                ...JSON.parse(contents).compilerOptions,
                strict: false,
              },
            })
          : `${contents}\nUpdated shared package guide.\n`,
      );
      const changedRun = dryRun(directory);
      const changed = new Map(
        changedRun.tasks.map((task) => [task.taskId, task]),
      );
      if (file === 'packages/shared/README.md')
        expect(
          changedRun.globalCacheInputs.hashOfInternalDependencies,
        ).not.toBe(baselineRun.globalCacheInputs.hashOfInternalDependencies);
      for (const task of baseline.values()) {
        expect(
          getTask(changed, task.taskId).hash,
          `${task.taskId}: ${file}`,
        ).not.toBe(task.hash);
      }
      await writeFile(target, contents);
      expect(graph(directory)).toEqual(baseline);
    }
  }, 60_000);

  test('daemon checks hash their canonical client closure without hashing unrelated sandbox source', async () => {
    const daemonRoot = join(ROOT, 'services/sandbox-runtime/daemon');
    const config = z
      .object({
        tasks: z.record(
          z.string(),
          z.object({ inputs: z.array(z.string()).optional() }),
        ),
      })
      .parse(
        JSON.parse(await readFile(join(daemonRoot, 'turbo.json'), 'utf8')),
      );
    for (const name of DAEMON_TASKS) {
      expect(config.tasks[name]?.inputs?.slice(0, 2), name).toEqual([
        '$TURBO_EXTENDS$',
        '$TURBO_DEFAULT$',
      ]);
      const task = getTask(tasks, `@tale/sandbox-runtime-daemon#${name}`);
      expect(task.command).not.toBe('<NONEXISTENT>');
      for (const file of DAEMON_OUTSIDE_FILES) {
        const input = relative(daemonRoot, join(ROOT, file))
          .split(sep)
          .join('/');
        expect(
          task.inputs[input],
          `${task.taskId} hashes ${file}`,
        ).toBeDefined();
      }
      expect(
        prerequisites(task, tasks).map((entry) => entry.taskId),
      ).not.toContain('@tale/sandbox#transit');
    }

    const directory = await fixture(true);
    const baseline = graph(directory);
    for (const file of DAEMON_OUTSIDE_FILES) {
      const target = join(directory, file);
      const original = await readFile(target, 'utf8');
      await writeFile(target, `${original}\nexport const changed = true;\n`);
      const changed = graph(directory);
      for (const name of DAEMON_TASKS) {
        const id = `@tale/sandbox-runtime-daemon#${name}`;
        expect(getTask(changed, id).hash, `${id}: ${file}`).not.toBe(
          getTask(baseline, id).hash,
        );
        const unrelated = `@tale/unrelated#${name}`;
        expect(getTask(changed, unrelated).hash, unrelated).toBe(
          getTask(baseline, unrelated).hash,
        );
      }
      const build = '@tale/sandbox-runtime-daemon#build';
      expect(getTask(changed, build).hash, build).toBe(
        getTask(baseline, build).hash,
      );
      await writeFile(target, original);
      expect(graph(directory)).toEqual(baseline);
    }
    await writeFile(
      join(directory, 'services/sandbox/src/unrelated.ts'),
      'export const value = 2;\n',
    );
    const unrelated = graph(directory);
    for (const name of [...DAEMON_TASKS, 'build']) {
      const id = `@tale/sandbox-runtime-daemon#${name}`;
      expect(getTask(unrelated, id).hash, id).toBe(getTask(baseline, id).hash);
    }
  }, 60_000);

  test('static build caches restore SSR, SEO and source-side generated data', () => {
    for (const [workspace, generated] of [
      ['web', ['app/generated/releases-manifest.ts']],
      ['docs', ['app/content/frontmatter.json', 'public/search-index-*.json']],
      ['ui-docs', ['app/content/frontmatter.json', 'public/search-index.json']],
    ] as const) {
      const outputs = getTask(tasks, `@tale/${workspace}#build`)
        .resolvedTaskDefinition.outputs;
      for (const output of [
        'dist/**',
        'dist-ssr/**',
        'dist-seo/**',
        ...generated,
      ])
        expect(outputs, `${workspace} ${output}`).toContain(output);
    }
    expect(
      getTask(tasks, '@tale/web#build').inputs[
        'app/generated/releases-manifest.ts'
      ],
    ).toBeDefined();
  });

  test('a committed release snapshot edit invalidates the web build', async () => {
    const directory = await fixture();
    const before = graph(directory);
    const id = '@tale/web#build';
    expect(
      getTask(before, id).inputs['app/generated/releases-manifest.ts'],
    ).toBeDefined();
    await writeFile(
      join(directory, 'packages/web/app/generated/releases-manifest.ts'),
      "export const RELEASES = [{ tag: 'v1.1.0' }];\n",
    );
    const after = graph(directory);
    expect(getTask(after, id).hash).not.toBe(getTask(before, id).hash);
    expect(
      getTask(after, id).inputs['app/generated/releases-manifest.ts'],
    ).not.toBe(
      getTask(before, id).inputs['app/generated/releases-manifest.ts'],
    );
    expect(getTask(after, '@tale/unrelated#build').hash).toBe(
      getTask(before, '@tale/unrelated#build').hash,
    );
  }, 60_000);

  test('CLI checks invalidate embedded data and platform imports without hashing the frontend', async () => {
    const directory = await fixture();
    let previous = graph(directory);
    for (const file of [
      'services/platform/backend/core/reference.ts',
      'services/platform/backend/auth/oidc.ts',
      'configs/platform/system/connectors/example/connector.yml',
    ]) {
      await writeFile(join(directory, file), `changed ${file}\n`);
      const changed = graph(directory);
      for (const name of ['lint', 'typecheck', 'test']) {
        const id = `@tale/cli#${name}`;
        expect(getTask(changed, id).hash, `${id}: ${file}`).not.toBe(
          getTask(previous, id).hash,
        );
      }
      previous = changed;
    }
    await writeFile(
      join(directory, 'services/platform/app/unrelated.ts'),
      'export const value = 2;\n',
    );
    const frontendChanged = graph(directory);
    for (const name of ['lint', 'typecheck', 'test']) {
      const id = `@tale/cli#${name}`;
      expect(getTask(frontendChanged, id).hash, id).toBe(
        getTask(previous, id).hash,
      );
    }
  }, 60_000);
});
