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
) as { jobs: { build: { steps: Step[]; 'timeout-minutes': number } } };
const cliPackage = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
) as { scripts: { test: string } };
const steps = workflow.jobs.build.steps;

test('native source tests retain the pinned Bun and existing deadlines', () => {
  expect(
    steps.find((step) => step.name === 'Setup Bun')?.with?.['bun-version'],
  ).toBe('1.4.2');
  expect(cliPackage.scripts.test).toBe('bun test --timeout 30000');
  expect(workflow.jobs.build['timeout-minutes']).toBe(15);
});

function sourceCommand() {
  const command = steps
    .find((step) => step.name === 'Run unit tests')
    ?.run?.trim();
  if (!command) throw new Error('Native CLI source command is required');
  return command;
}

test.each(['linux', 'macos', 'windows'])(
  'the native %s source command retains its proven scheduling',
  (platform) => {
    expect(sourceCommand(), platform).toBe('bun run test');
  },
);

test('the actual native source command discovers every file and completes subprocesses', async () => {
  if (!['linux', 'darwin', 'win32'].includes(process.platform))
    throw new Error('Unsupported native CLI test host');
  const directory = await mkdtemp(join(tmpdir(), 'tale-cli-parallel-'));
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
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { value, setValue } from './state';

test('reset file state and subprocess completion', async () => {
  expect(value).toBe(0);
  expect(globalThis.__taleParallelFixture).toBeUndefined();
  const sync = spawnSync(process.execPath, ['-e', 'process.stdout.write("sync")'], { encoding: 'utf8' });
  expect(sync.status).toBe(0);
  expect(sync.stdout).toBe('sync');
  const child = Bun.spawn([process.execPath, '-e', 'process.stdout.write("async")'], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect(status, stderr).toBe(0);
  expect(stdout).toBe('async');
  setValue(1);
  globalThis.__taleParallelFixture = ${JSON.stringify(name)};
});
test('the prior case completed before this case', () => {
  expect(value).toBe(1);
  expect(globalThis.__taleParallelFixture).toBe(${JSON.stringify(name)});
  writeFileSync(join(process.env.TALE_PARALLEL_PROOF_DIR, ${JSON.stringify(`${name}.json`)}),
    JSON.stringify({ worker: process.env.BUN_TEST_WORKER_ID, pid: process.pid }));
  setValue(0); delete globalThis.__taleParallelFixture;
});
`,
      );
    }
    const selected = sourceCommand();
    const command = selected.split(/\s+/);
    if (command[0] !== 'bun')
      throw new Error('Native CLI source command must use the pinned Bun');
    const child = Bun.spawn([process.execPath, ...command.slice(1)], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
        TALE_BINARY: '',
        TALE_PARALLEL_PROOF_DIR: directory,
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
