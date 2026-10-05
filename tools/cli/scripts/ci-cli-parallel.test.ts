import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

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

test.each(['linux', 'macos', 'windows'])(
  'the native %s source command runs every file with its selected scheduling and serial cases',
  async (platform) => {
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
  ${platform !== 'macos' ? 'setValue(0); delete globalThis.__taleParallelFixture;' : ''}
});
`,
        );
      }
      const expression = steps
        .find((step) => step.name === 'Run unit tests')
        ?.run?.trim()
        .replace(/^\$\{\{\s*|\s*\}\}$/g, '');
      if (!expression)
        throw new Error(
          'Native CLI source command must select the matrix platform',
        );
      const selected = runInNewContext(expression, {
        matrix: { platform },
      }) as unknown;
      if (typeof selected !== 'string')
        throw new Error('Native CLI source command must resolve to a string');
      expect(selected).toBe(
        platform === 'macos' ? 'bun run test --parallel=2' : 'bun run test',
      );
      const command = selected.split(/\s+/);
      if (command[0] !== 'bun')
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
      if (platform !== 'macos') {
        // Serial Bun can inherit the parent's BUN_TEST_WORKER_ID. One PID,
        // every file receipt and each case's state assertions prove this lane.
        expect(new Set(results.map((result) => result.pid)).size).toBe(1);
      } else {
        // The first worker can finish these tiny files before its sibling starts.
        const workers = new Set(results.map((result) => result.worker));
        expect(workers.size).toBeGreaterThanOrEqual(1);
        expect(workers.size).toBeLessThanOrEqual(2);
        expect(new Set(results.map((result) => result.pid)).size).toBe(
          workers.size,
        );
        for (const worker of workers) {
          expect(['1', '2']).toContain(worker);
          expect(
            new Set(
              results
                .filter((result) => result.worker === worker)
                .map((result) => result.pid),
            ).size,
          ).toBe(1);
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
