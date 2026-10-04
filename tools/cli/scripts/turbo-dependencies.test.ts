import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const temporary: string[] = [];
const checks = [
  'lint',
  'typecheck',
  'test',
  'test:ui',
  'test:browser',
  'test:coverage',
];
type Task = {
  taskId: string;
  hash: string;
  command: string;
  dependencies: string[];
  inputs: Record<string, string>;
};
type Config = {
  globalDependencies: string[];
  tasks: Record<
    string,
    { dependsOn?: string[]; outputs?: string[]; cache?: boolean }
  >;
};
const turbo = join(root, 'node_modules/turbo/bin/turbo');

function dryRun(directory: string, tasks: string[]): Task[] {
  const run = Bun.spawnSync(
    [
      process.execPath,
      turbo,
      'run',
      ...tasks,
      '--dry=json',
      '--cache=local:,remote:',
    ],
    {
      cwd: directory,
    },
  );
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  const output = run.stdout.toString();
  return (JSON.parse(output.slice(output.indexOf('{'))) as { tasks: Task[] })
    .tasks;
}

afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('parallel checks invalidate cached consumers of workspace sources', () => {
  test('CLI artifacts embedding Git provenance are always generated from the current checkout', async () => {
    const config = JSON.parse(
      await readFile(join(root, 'turbo.json'), 'utf8'),
    ) as Config;
    for (const task of ['@tale/cli#generate', '@tale/cli#build']) {
      expect(config.tasks[task]?.cache, task).toBe(false);
    }
  });

  test('every centralized compiler config is a global cache input', async () => {
    const config = JSON.parse(
      await readFile(join(root, 'turbo.json'), 'utf8'),
    ) as Config;
    const configs = (await readdir(root)).filter((name) =>
      /^tsconfig.*\.json$/.test(name),
    );
    expect(configs.length).toBeGreaterThan(1);
    for (const path of configs) {
      expect(
        config.globalDependencies.some((pattern) =>
          new Bun.Glob(pattern).match(path),
        ),
        path,
      ).toBe(true);
    }
  });

  test('CLI reference inputs ignore catalog task logs while real sources invalidate verdicts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tale-cli-catalog-inputs-'));
    temporary.push(directory);
    const write = async (path: string, content: string) => {
      const file = join(directory, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
    };
    const config = JSON.parse(
      await readFile(join(root, 'turbo.json'), 'utf8'),
    ) as Config;
    await write('turbo.json', JSON.stringify({ tasks: config.tasks }));
    await write(
      'package.json',
      JSON.stringify({
        name: 'catalog-input-fixture',
        private: true,
        packageManager: 'bun@1.4.2',
        workspaces: ['tools/*'],
      }),
    );
    await write('.gitignore', '.turbo\n');
    await write(
      'tools/cli/package.json',
      JSON.stringify({
        name: '@tale/cli',
        scripts: {
          test: 'echo never executed',
          generate: 'echo never executed',
        },
      }),
    );
    await write(
      'tools/cli/turbo.json',
      await readFile(join(root, 'tools/cli/turbo.json'), 'utf8'),
    );
    const skill = 'configs/platform/custom/skills/catalog-fixture/source.ts';
    const connector =
      'configs/platform/system/connectors/fixture/connector.yml';
    const log =
      'configs/platform/custom/skills/catalog-fixture/.turbo/turbo-test.log';
    await write(skill, 'export const version = 1;\n');
    await write(connector, 'name: original\n');
    for (const command of [
      [process.execPath, 'install', '--ignore-scripts'],
      ['git', 'init', '--quiet'],
      ['git', 'add', '.'],
    ]) {
      const result = Bun.spawnSync(command, { cwd: directory });
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    }
    const selected = ['@tale/cli#test', '@tale/cli#generate'];
    const snapshots = () =>
      dryRun(directory, ['test', 'generate', '--filter=@tale/cli'])
        .filter((task) => selected.includes(task.taskId))
        .map(({ taskId, hash, inputs }) => ({ taskId, hash, inputs }));
    const baseline = snapshots();
    expect(baseline.map(({ taskId }) => taskId).sort()).toEqual(
      selected.toSorted(),
    );
    for (const task of baseline) {
      expect(task.inputs[`../../${skill}`], task.taskId).toBeDefined();
      expect(task.inputs[`../../${connector}`], task.taskId).toBeDefined();
    }
    for (const content of ['test pass\n', 'different test output\n']) {
      await write(log, content);
      const ignored = Bun.spawnSync(['git', 'check-ignore', '--', log], {
        cwd: directory,
      });
      expect(ignored.exitCode, ignored.stderr.toString()).toBe(0);
      expect(snapshots()).toEqual(baseline);
    }
    for (const [path, original, changed] of [
      [skill, 'export const version = 1;\n', 'export const version = 2;\n'],
      [connector, 'name: original\n', 'name: changed\n'],
    ] as const) {
      await write(path, changed);
      for (const task of snapshots()) {
        const previous = baseline.find(
          (entry) => entry.taskId === task.taskId,
        )!;
        expect(task.hash, `${task.taskId}/${path}`).not.toBe(previous.hash);
        expect(task.inputs[`../../${path}`]).not.toBe(
          previous.inputs[`../../${path}`],
        );
      }
      await write(path, original);
      expect(snapshots()).toEqual(baseline);
    }
  }, 30_000);

  test('the real graph includes dependency sources without serializing executable checks', () => {
    const tasks = dryRun(root, [
      ...checks,
      '--filter=@tale/web',
      '--filter=@tale/cli',
    ]);
    const byId = new Map(tasks.map((task) => [task.taskId, task]));
    const closure = (id: string, found = new Set<string>()): Set<string> => {
      for (const dependency of byId.get(id)?.dependencies ?? []) {
        if (found.has(dependency)) continue;
        found.add(dependency);
        closure(dependency, found);
      }
      return found;
    };
    for (const workspace of ['@tale/web', '@tale/cli']) {
      for (const check of checks) {
        const task = byId.get(`${workspace}#${check}`);
        if (!task?.command || task.command === '<NONEXISTENT>') continue;
        const dependencies = closure(task.taskId);
        const expected =
          workspace === '@tale/web'
            ? ['@tale/ui#transit', '@tale/marketing-ui#transit']
            : ['@tale/shared#transit'];
        for (const id of expected) {
          expect(dependencies, task.taskId).toContain(id);
          expect(byId.get(id)?.command, id).toBe('<NONEXISTENT>');
        }
        expect(
          Array.from(dependencies).some((dependency) =>
            dependency.endsWith(`#${check}`),
          ),
        ).toBe(false);
      }
    }
    expect(byId.get('@tale/marketing-ui#transit')?.dependencies).toContain(
      '@tale/ui#transit',
    );
  }, 30_000);

  test('a transitive package edit changes every check hash while unrelated packages stay cached', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tale-turbo-dependencies-'));
    temporary.push(directory);
    const config = JSON.parse(
      await readFile(join(root, 'turbo.json'), 'utf8'),
    ) as Config;
    const tasks = Object.fromEntries(
      Object.entries(config.tasks).filter(([name]) => !name.includes('#')),
    );
    await writeFile(join(directory, 'turbo.json'), JSON.stringify({ tasks }));
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        name: 'cache-fixture',
        private: true,
        packageManager: 'bun@1.4.2',
        workspaces: ['packages/*'],
      }),
    );
    for (const [name, dependencies] of [
      ['shared', {}],
      ['ui', { '@fixture/shared': 'workspace:*' }],
      ['app', { '@fixture/ui': 'workspace:*' }],
      ['unrelated', {}],
    ] as const) {
      const workspace = join(directory, 'packages', name);
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, 'package.json'),
        JSON.stringify({
          name: `@fixture/${name}`,
          version: '1.0.0',
          dependencies,
          scripts: Object.fromEntries(
            checks.map((check) => [check, 'echo check']),
          ),
        }),
      );
      await writeFile(
        join(workspace, 'source.ts'),
        'export const value = 1;\n',
      );
    }
    const install = Bun.spawnSync(
      [process.execPath, 'install', '--ignore-scripts'],
      { cwd: directory },
    );
    if (install.exitCode !== 0) throw new Error(install.stderr.toString());
    const before = new Map(
      dryRun(directory, checks).map((task) => [task.taskId, task.hash]),
    );
    await writeFile(
      join(directory, 'packages/shared/source.ts'),
      'export const value = 2;\n',
    );
    const after = new Map(
      dryRun(directory, checks).map((task) => [task.taskId, task.hash]),
    );
    for (const check of checks) {
      expect(after.get(`@fixture/app#${check}`)).not.toBe(
        before.get(`@fixture/app#${check}`),
      );
      expect(after.get(`@fixture/ui#${check}`)).not.toBe(
        before.get(`@fixture/ui#${check}`),
      );
      expect(after.get(`@fixture/unrelated#${check}`)).toBe(
        before.get(`@fixture/unrelated#${check}`),
      );
    }
  }, 30_000);
});
