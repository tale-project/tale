import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { parse } from 'yaml';

type Step = {
  name: string;
  run?: string;
  with?: Record<string, string>;
};

const workflow = parse(
  await readFile(
    new URL('../../../.github/workflows/cli.yml', import.meta.url),
    'utf8',
  ),
) as {
  jobs: {
    build: {
      steps: Step[];
      'timeout-minutes': number;
      strategy: {
        matrix: { include: { platform: string; cross?: boolean }[] };
      };
    };
  };
};
const cliPackage = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
) as { scripts: { test: string } };
const steps = workflow.jobs.build.steps;

test('native source tests use the pinned Bun and retain fixture timeouts', () => {
  expect(
    steps.find((step) => step.name === 'Setup Bun')?.with?.['bun-version'],
  ).toBe('1.4.2');
  expect(cliPackage.scripts.test).toBe('bun test --timeout 30000');
  expect(workflow.jobs.build['timeout-minutes']).toBe(15);
});

function sourceCommand(platform: string) {
  const target = workflow.jobs.build.strategy.matrix.include.find(
    (entry) => entry.platform === platform && !entry.cross,
  );
  if (!target) throw new Error('Native CLI source target is missing');
  const command = steps
    .find((step) => step.name === 'Run unit tests')
    ?.run?.trim();
  if (!command) throw new Error('Native CLI source command is missing');
  return command;
}

test.each(['linux', 'macos', 'windows'])(
  'the native %s source command runs the complete suite serially',
  (platform) => {
    expect(sourceCommand(platform)).toBe('bun run test');
  },
);

test('the actual native serial source command discovers every file in sequence and completes subprocesses', async () => {
  const platforms: Record<string, string | undefined> = {
    linux: 'linux',
    darwin: 'macos',
    win32: 'windows',
  };
  const platform = platforms[process.platform];
  if (!platform) throw new Error('Unsupported native CLI test host');
  const directory = await mkdtemp(join(tmpdir(), 'tale-cli-serial-'));
  try {
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        type: 'module',
        scripts: { test: cliPackage.scripts.test },
      }),
    );
    await writeFile(
      join(directory, 'state.ts'),
      'export let value = 0; export function setValue(next: number) { value = next; }\n',
    );
    const files = ['a', 'b', 'c', 'd'];
    for (const name of files) {
      await writeFile(
        join(directory, `${name}.test.ts`),
        `import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { value, setValue } from './state';

test('fresh file state and subprocess completion', async () => {
  expect(value).toBe(0);
  expect(globalThis.__taleSerialFixture).toBeUndefined();
  const record = event => appendFileSync(join(process.env.TALE_SERIAL_PROOF_DIR, 'events'), ${JSON.stringify(name)} + ':' + event + '\\n');
  record('start');
  const sync = spawnSync(process.execPath, ['-e', 'process.stdout.write("sync")'], { encoding: 'utf8' });
  expect(sync.status).toBe(0);
  expect(sync.stdout).toBe('sync');
  const child = Bun.spawn([process.execPath, '-e', 'process.stdout.write("async")'], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect(status, stderr).toBe(0);
  expect(stdout).toBe('async');
  const repository = join(process.env.TALE_SERIAL_PROOF_DIR, ${JSON.stringify(`git-${name}`)});
  mkdirSync(repository);
  writeFileSync(join(repository, 'compose.yml'), 'services: {}');
  writeFileSync(join(repository, 'Caddyfile'), 'localhost { respond "fixture" }');
  const init = spawnSync('git', ['-C', repository, 'init', '-q'], { encoding: 'utf8' });
  expect(init.status, init.stderr).toBe(0);
  const add = spawnSync('git', ['-C', repository, 'add', '.'], { encoding: 'utf8' });
  expect(add.status, add.stderr).toBe(0);
  const git = Bun.spawn(['git', '-C', repository, 'ls-files'], { stdout: 'pipe', stderr: 'pipe' });
  const [tracked, gitError, gitStatus] = await Promise.all([
    new Response(git.stdout).text(), new Response(git.stderr).text(), git.exited,
  ]);
  expect(gitStatus, gitError).toBe(0);
  expect(tracked.trim().split(/\\r?\\n/)).toEqual(['Caddyfile', 'compose.yml']);
  record('subprocesses-complete');
  setValue(1);
  globalThis.__taleSerialFixture = ${JSON.stringify(name)};
});
test('the prior case completed before this case', () => {
  expect(value).toBe(1);
  expect(globalThis.__taleSerialFixture).toBe(${JSON.stringify(name)});
  appendFileSync(join(process.env.TALE_SERIAL_PROOF_DIR, 'events'), ${JSON.stringify(`${name}:finish\n`)});
  writeFileSync(join(process.env.TALE_SERIAL_PROOF_DIR, ${JSON.stringify(`${name}.json`)}),
    JSON.stringify({ worker: process.env.BUN_TEST_WORKER_ID, pid: process.pid }));
  setValue(0);
  delete globalThis.__taleSerialFixture;
});
`,
      );
    }
    const selected = sourceCommand(platform);
    const command = selected.split(/\s+/);
    if (command[0] !== 'bun')
      throw new Error('Native CLI source command must use the pinned Bun');
    const child = Bun.spawn([process.execPath, ...command.slice(1)], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
        TALE_BINARY: '',
        TALE_SERIAL_PROOF_DIR: directory,
        BUN_TEST_WORKER_ID: undefined,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(status, stdout + stderr).toBe(0);
    expect(stdout + stderr).toContain('8 pass');
    expect(stdout + stderr).toContain('Ran 8 tests across 4 files');
    const events = (await readFile(join(directory, 'events'), 'utf8'))
      .trim()
      .split('\n');
    expect(events).toHaveLength(files.length * 3);
    const discovered = events
      .filter((event) => event.endsWith(':start'))
      .map((event) => event.split(':')[0]);
    expect(discovered.toSorted()).toEqual(files);
    expect(events).toEqual(
      discovered.flatMap((name) => [
        `${name}:start`,
        `${name}:subprocesses-complete`,
        `${name}:finish`,
      ]),
    );
    const results = await Promise.all(
      files.map(
        async (name) =>
          JSON.parse(
            await readFile(join(directory, `${name}.json`), 'utf8'),
          ) as {
            worker?: string;
            pid: number;
          },
      ),
    );
    expect(new Set(results.map((result) => result.worker))).toEqual(
      new Set([undefined]),
    );
    expect(new Set(results.map((result) => result.pid)).size).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
