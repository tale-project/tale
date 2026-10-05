import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
const temporary: string[] = [];

const dryRunSchema = z.object({
  globalCacheInputs: z.object({ files: z.record(z.string(), z.string()) }),
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
async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tale-turbo-dependencies-'));
  temporary.push(directory);
  await writeFile(
    join(directory, 'turbo.json'),
    await readFile(join(ROOT, 'turbo.json')),
  );
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({
      name: 'cache-regression-fixture',
      private: true,
      packageManager: 'bun@1.4.2',
      workspaces: ['packages/*'],
    }),
  );
  await writeFile(join(directory, '.gitignore'), '.turbo/\ndist/\n');
  for (const [name, dependencies] of [
    ['ui', {}],
    ['marketing-ui', { '@tale/ui': 'workspace:*' }],
    ['web', { '@tale/marketing-ui': 'workspace:*' }],
    ['shared', {}],
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
