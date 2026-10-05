import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
) as { jobs: { build: { steps: Step[] } } };
const cliPackage = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
) as { scripts: { test: string } };
const steps = workflow.jobs.build.steps;

test('native source workers use the pinned isolation-capable Bun and retain fixture timeouts', () => {
  expect(
    steps.find((step) => step.name === 'Setup Bun')?.with?.['bun-version'],
  ).toBe('1.4.2');
  expect(cliPackage.scripts.test).toBe('bun test --timeout 30000');
});

test('the native source command runs every file with two workers, isolated globals and serial cases', async () => {
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
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { value, setValue } from './state';

test('fresh file state', async () => {
  expect(value).toBe(0);
  expect(globalThis.__taleParallelFixture).toBeUndefined();
  await Bun.sleep(50);
  setValue(1);
  globalThis.__taleParallelFixture = ${JSON.stringify(name)};
});
test('the prior case completed before this case', () => {
  expect(value).toBe(1);
  expect(globalThis.__taleParallelFixture).toBe(${JSON.stringify(name)});
  writeFileSync(join(process.env.TALE_PARALLEL_PROOF_DIR, ${JSON.stringify(`${name}.json`)}),
    JSON.stringify({ worker: process.env.BUN_TEST_WORKER_ID, pid: process.pid }));
});
`,
      );
    }
    const command = steps
      .find((step) => step.name === 'Run unit tests')
      ?.run?.trim()
      .split(/\s+/);
    if (!command || command[0] !== 'bun')
      throw new Error('Native CLI source command must use the pinned Bun');
    const child = Bun.spawn([process.execPath, ...command.slice(1)], {
      cwd: directory,
      env: {
        ...process.env,
        TALE_BINARY: '',
        TALE_PARALLEL_PROOF_DIR: directory,
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
            worker: string;
            pid: number;
          },
      ),
    );
    expect([...new Set(results.map((result) => result.worker))].sort()).toEqual(
      ['1', '2'],
    );
    expect(new Set(results.map((result) => result.pid)).size).toBe(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
