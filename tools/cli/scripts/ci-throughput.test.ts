import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { parse } from 'yaml';
import { z } from 'zod';

const stepSchema = z.object({
  name: z.string().optional(),
  run: z.string().optional(),
  uses: z.string().optional(),
  if: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  with: z.record(z.string(), z.unknown()).optional(),
});
const workflowSchema = z.object({
  env: z.record(z.string(), z.string()).optional(),
  on: z.object({
    pull_request: z.object({ paths: z.array(z.string()).optional() }),
  }),
  jobs: z.record(
    z.string(),
    z.object({
      name: z.string(),
      needs: z.union([z.string(), z.array(z.string())]).optional(),
      strategy: z
        .object({
          'fail-fast': z.boolean(),
          matrix: z.object({ shard: z.array(z.number()).optional() }),
        })
        .optional(),
      steps: z.array(stepSchema).default([]),
    }),
  ),
});
const workflow = async (name: string) =>
  workflowSchema.parse(
    parse(
      await readFile(
        new URL(`../../../.github/workflows/${name}.yml`, import.meta.url),
        'utf8',
      ),
    ),
  );

describe('CI test partitioning preserves the complete validation', () => {
  test.each([
    ['checks', 'test-ui-shards'],
    ['e2e', 'e2e'],
  ])('%s/%s runs each declared shard exactly once', async (file, id) => {
    const job = (await workflow(file)).jobs[id];
    const runner = job.steps.find((step) => step.run?.includes('--shard='))!;
    const denominator = /--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/.exec(
      runner.run!,
    );
    expect(denominator).not.toBeNull();
    const total = Number(denominator![1]);
    expect(total).toBeGreaterThan(1);
    // A missing/duplicated numerator or a changed denominator would silently
    // drop or repeat part of the suite even if every scheduled job is green.
    expect(job.strategy?.matrix.shard?.toSorted((a, b) => a - b)).toEqual(
      Array.from({ length: total }, (_, index) => index + 1),
    );
    expect(job.strategy?.['fail-fast']).toBe(false);
    expect(runner.run).not.toMatch(/--(?:grep|exclude|testNamePattern)/);
  });

  test('platform UI is sharded while other workspaces run once', async () => {
    const job = (await workflow('checks')).jobs['test-ui-shards'];
    const platform = job.steps.find((step) => step.name === 'Run UI tests')!;
    const others = job.steps.find(
      (step) => step.name === 'Run other workspace UI tests',
    )!;
    expect(platform.run).toContain(
      'test:ui --filter=@tale/platform -- --shard=',
    );
    expect(others.run).toBe(
      "bunx turbo run test:ui --filter='!@tale/platform'",
    );
    expect(others.if).toBe('matrix.shard == 1');
    expect(
      job.strategy?.matrix.shard?.filter((shard) => shard === 1),
    ).toHaveLength(1);
  });

  test.each(['success', 'failure', 'cancelled', 'skipped', ''])(
    'the stable UI check fails closed for shard result %j',
    async (result) => {
      const job = (await workflow('checks')).jobs['test-ui'];
      expect(job.name).toBe('UI');
      expect([job.needs].flat()).toContain('test-ui-shards');
      expect(job.steps.some((step) => step.uses)).toBe(false);
      const guard = job.steps.find(
        (step) => step.name === 'Require every UI shard',
      )!;
      expect(guard.env?.SHARDS_RESULT).toBe(
        '${{ needs.test-ui-shards.result }}',
      );
      const execution = Bun.spawnSync(['bash', '-c', guard.run!], {
        env: { ...process.env, SHARDS_RESULT: result },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(execution.exitCode === 0).toBe(result === 'success');
    },
  );
});

test('E2E uses the normal build cache and one artifact for every platform shard', async () => {
  const file = await workflow('e2e');
  const build = file.jobs.build;
  const suite = file.jobs.e2e;
  expect(file.env?.TURBO_API).toBeUndefined();
  const setup = build.steps.find((step) => step.name === 'Setup toolchain')!;
  expect(setup.with?.['turbo-cache']).not.toBe('false');
  expect(setup.with?.['cache-scope']).toBe('build');
  const checksBuild = (await workflow('checks')).jobs.build;
  expect(
    checksBuild.steps.find((step) => step.name === 'Setup toolchain')?.with?.[
      'cache-scope'
    ],
  ).toBe(setup.with?.['cache-scope']);
  const compile = build.steps.find((step) =>
    step.name?.startsWith('Build platform'),
  )!;
  expect(compile.run).toBe('bunx turbo run build --filter=@tale/platform');
  expect(compile.if).toBeUndefined();
  expect(
    build.steps.some((step) => step.name?.includes('Cache platform dist')),
  ).toBe(false);
  const upload = build.steps.find((step) =>
    step.uses?.startsWith('actions/upload-artifact@'),
  )!;
  const download = suite.steps.find((step) =>
    step.uses?.startsWith('actions/download-artifact@'),
  )!;
  expect(upload.with?.name).toBe(download.with?.name);
  expect(upload.with?.path).toBe(download.with?.path);
  expect(upload.with?.['if-no-files-found']).toBe('error');
  expect([suite.needs].flat()).toContain('build');
  expect(
    suite.steps.some((step) =>
      /\b(?:run build|turbo run build)\b/.test(step.run ?? ''),
    ),
  ).toBe(false);
  expect(
    suite.steps.find((step) => step.run?.includes('playwright test'))?.env
      ?.E2E_WORKERS,
  ).toBe('1');
});

test('E2E source scopes include the build and test inputs outside services', async () => {
  const file = await workflow('e2e');
  expect(file.on.pull_request.paths).toEqual(
    expect.arrayContaining([
      'docs/**',
      'packages/shared/**',
      'configs/platform/**',
      'tsconfig*.json',
      'patches/**',
      'bunfig.toml',
    ]),
  );
});
