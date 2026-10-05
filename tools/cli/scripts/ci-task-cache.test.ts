import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { requiresTaskProvisioning } from '../../../scripts/ci-task-cache';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
const turbo = join(repository, 'node_modules/turbo/bin/turbo');
const directories: string[] = [];
const planSchema = z.object({
  tasks: z.array(
    z
      .object({
        taskId: z.string(),
        task: z.string(),
        command: z.string(),
        hash: z.string(),
        logFile: z.string(),
        dependencies: z.array(z.string()),
        cache: z.object({ local: z.boolean(), status: z.string() }),
        resolvedTaskDefinition: z.object({
          cache: z.boolean(),
          persistent: z.boolean(),
        }),
      })
      .passthrough(),
  ),
});
type Plan = z.infer<typeof planSchema>;

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const run = (command: string, args: string[], cwd: string) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      TURBO_CACHE_DIR: join(cwd, '.turbo/cache'),
      TURBO_CACHE_MAX_SIZE: '0',
      TURBO_CACHE_MAX_AGE: '0',
      TURBO_TELEMETRY_DISABLED: '1',
      TURBO_FORCE: '',
    },
  });
  expect(result.status, result.stderr + result.stdout).toBe(0);
  return result;
};

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tale-browser-cache-'));
  directories.push(directory);
  const write = async (file: string, text: string) => {
    const path = join(directory, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  };
  await write(
    'package.json',
    JSON.stringify({
      name: 'browser-cache-fixture',
      private: true,
      packageManager: 'bun@1.4.2',
      workspaces: ['packages/*'],
    }),
  );
  await write('.gitignore', '.turbo/\ncount.log\n');
  await write(
    'turbo.json',
    JSON.stringify({
      cacheMaxSize: '1KB',
      cacheMaxAge: '1s',
      tasks: {
        transit: { dependsOn: ['^transit'], outputs: [] },
        prepare: { outputs: [] },
        'test:browser': { dependsOn: ['^transit', 'prepare'], outputs: [] },
      },
    }),
  );
  for (const name of ['first', 'second', 'source']) {
    await write(
      `packages/${name}/package.json`,
      JSON.stringify({
        name: `@fixture/${name}`,
        version: '0.0.0',
        dependencies:
          name === 'source' ? {} : { '@fixture/source': 'workspace:*' },
        scripts:
          name === 'source'
            ? {}
            : { prepare: 'echo prepared', 'test:browser': 'bun execute.ts' },
      }),
    );
    await write(`packages/${name}/source.ts`, 'export const version = 1;\n');
    if (name !== 'source')
      await write(
        `packages/${name}/execute.ts`,
        "import { appendFileSync } from 'node:fs';\nappendFileSync('count.log', 'executed\\n');\nconsole.warn('fixture warning: one optional case skipped');\n",
      );
  }
  run('git', ['init', '-q'], directory);
  run('git', ['add', '.'], directory);
  run(
    'git',
    [
      '-c',
      'user.name=CI Cache Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-qm',
      'fixture',
      '--no-gpg-sign',
      '--no-verify',
    ],
    directory,
  );
  return directory;
}

const plan = (directory: string): Plan =>
  planSchema.parse(
    JSON.parse(
      run(
        process.execPath,
        [turbo, 'run', 'test:browser', '--dry=json', '--cache=local:r,remote:'],
        directory,
      ).stdout,
    ),
  );

describe('browser prerequisite cache admission', () => {
  test('real Turbo cold, warm and transitive-source states retain the normal test verdict and warning log without eviction', async () => {
    const directory = await fixture();
    expect(requiresTaskProvisioning(plan(directory), 'test:browser')).toBe(
      true,
    );
    const execute = () =>
      run(
        process.execPath,
        [
          turbo,
          'run',
          'test:browser',
          '--cache=local:rw,remote:',
          '--output-logs=errors-only',
          '--summarize',
        ],
        directory,
      );
    const first = execute();
    expect(first.stdout + first.stderr).not.toContain('fixture warning');
    // Configured size and age eviction must be disabled in both invocations:
    // a plan cannot skip provisioning if the verdict later evicts its hits.
    const cache = join(directory, '.turbo/cache');
    const history = join(cache, '1111111111111111.tar.zst');
    await writeFile(history, 'x'.repeat(32 * 1024));
    const old = new Date(Date.now() - 30 * 86_400_000);
    for (const entry of await readdir(cache))
      await utimes(join(cache, entry), old, old);
    const warm = plan(directory);
    expect(requiresTaskProvisioning(warm, 'test:browser')).toBe(false);
    expect(requiresTaskProvisioning(warm, 'test:browser', true)).toBe(true);
    const targets = warm.tasks.filter((task) =>
      task.command.includes('execute.ts'),
    );
    expect(targets).toHaveLength(2);
    for (const target of targets) {
      expect(target.cache).toMatchObject({ local: true, status: 'HIT' });
      expect(target.logFile).toEndWith('turbo-test$colon$browser.log');
      expect(await readFile(join(directory, target.logFile), 'utf8')).toContain(
        'fixture warning: one optional case skipped',
      );
    }
    execute();
    expect(await Bun.file(history).exists()).toBe(true);
    for (const name of ['first', 'second'])
      expect(
        await readFile(join(directory, `packages/${name}/count.log`), 'utf8'),
      ).toBe('executed\n');
    await writeFile(
      join(directory, 'packages/source/source.ts'),
      'export const version = 2;\n',
    );
    expect(requiresTaskProvisioning(plan(directory), 'test:browser')).toBe(
      true,
    );
    execute();
    for (const name of ['first', 'second'])
      expect(
        await readFile(join(directory, `packages/${name}/count.log`), 'utf8'),
      ).toBe('executed\nexecuted\n');
  }, 30_000);

  test('missing, remote-only, uncached and malformed executable prerequisites all retain provisioning', async () => {
    const directory = await fixture();
    run(
      process.execPath,
      [turbo, 'run', 'test:browser', '--cache=local:rw,remote:'],
      directory,
    );
    const warm = plan(directory);
    const prerequisite = warm.tasks.find((task) => task.task === 'prepare');
    expect(prerequisite).toBeDefined();
    for (const change of [
      { cache: { local: false, status: 'HIT' } },
      { cache: { local: true, status: 'MISS' } },
      { resolvedTaskDefinition: { cache: false, persistent: false } },
      { resolvedTaskDefinition: { cache: true, persistent: true } },
      { command: '<NONEXISTENT>' },
      { hash: 'not-a-task-hash' },
      { dependencies: [prerequisite!.taskId] },
      { task: 'transit', command: '<NONEXISTENT>' },
    ]) {
      const changed = {
        tasks: warm.tasks.map((task) =>
          task.taskId === prerequisite!.taskId ? { ...task, ...change } : task,
        ),
      };
      expect(
        requiresTaskProvisioning(changed, 'test:browser'),
        JSON.stringify(change),
      ).toBe(true);
    }
    expect(
      requiresTaskProvisioning(
        { tasks: warm.tasks.filter((task) => task !== prerequisite) },
        'test:browser',
      ),
    ).toBe(true);
    for (const malformed of [
      null,
      {},
      { tasks: [] },
      { tasks: 'HIT' },
      warm.tasks,
    ])
      expect(requiresTaskProvisioning(malformed, 'test:browser')).toBe(true);
    expect(
      requiresTaskProvisioning(
        { tasks: [...warm.tasks, warm.tasks[0]] },
        'test:browser',
      ),
    ).toBe(true);
  }, 30_000);

  test('candidate, force and unknown command requests retain provisioning without probing a cache', () => {
    for (const [args, env] of [
      [['test:browser'], { GITHUB_EVENT_NAME: 'repository_dispatch' }],
      [['test:browser'], { TURBO_FORCE: '1' }],
      [['test:browser', '--force'], {}],
      [['unknown'], {}],
    ] as const) {
      const child = spawnSync(
        process.execPath,
        [join(repository, 'scripts/ci-task-cache.ts'), ...args],
        {
          cwd: repository,
          encoding: 'utf8',
          env: { ...process.env, ...env },
        },
      );
      expect(child.status, child.stderr).toBe(0);
      expect(child.stdout).toBe('provision=true\n');
      expect(child.stderr).not.toContain('turbo 2.');
    }
  });
});
