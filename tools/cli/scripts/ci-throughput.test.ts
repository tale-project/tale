import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { parse } from 'yaml';
import { z } from 'zod';

const stepSchema = z.object({
  name: z.string().optional(),
  id: z.string().optional(),
  'working-directory': z.string().optional(),
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
      outputs: z.record(z.string(), z.string()).optional(),
      if: z.string().optional(),
      permissions: z.record(z.string(), z.string()).optional(),
      'timeout-minutes': z.number().optional(),
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
    const denominator =
      /--shard=\$\{\{ matrix\.shard \}\}\/(\d+|\$\{\{ strategy\.job-total \}\})/.exec(
        runner.run!,
      );
    expect(denominator).not.toBeNull();
    const total =
      denominator![1] === '${{ strategy.job-total }}'
        ? (job.strategy?.matrix.shard?.length ?? 0)
        : Number(denominator![1]);
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
      'test:ui --filter=@tale/platform --output-logs=errors-only --summarize -- --shard=',
    );
    expect(others.run).toBe(
      "bunx turbo run test:ui --filter='!@tale/platform' --output-logs=errors-only --summarize",
    );
    expect(others.if).toBe('matrix.shard == 1');
    expect(
      job.strategy?.matrix.shard?.filter((shard) => shard === 1),
    ).toHaveLength(1);
  });

  test('the stable UI verdict retains source and draft admission on cancellation', async () => {
    const file = await workflow('checks');
    const verdict = file.jobs['test-ui'];
    const shards = file.jobs['test-ui-shards'];
    expect(verdict.needs).toEqual(['candidate-source', 'test-ui-shards']);
    expect(verdict.if).toContain('always()');
    expect(verdict.if).not.toContain('needs.test-ui-shards.result');
    expect(verdict.permissions).toEqual({});
    expect(verdict['timeout-minutes']).toBeLessThanOrEqual(3);
    expect(shards.needs).toBe('candidate-source');
    expect(shards.if).toBe(verdict.if?.replace('always()', '!cancelled()'));
    expect(verdict.if).toContain('github.event.pull_request.draft != true');
    expect(
      shards.steps.find((step) => step.name === 'Checkout')?.with?.ref,
    ).toBe('${{ needs.candidate-source.outputs.candidate_sha }}');
    expect([file.jobs['candidate-gate'].needs].flat()).toEqual(
      expect.arrayContaining(['test-ui', 'test-ui-shards']),
    );
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

describe('Browser check cache', () => {
  test('shares installed-version headless binaries with E2E on each architecture', async () => {
    const job = (await workflow('checks')).jobs['test-browser'];
    const resolver = job.steps.find(
      (step) => step.id === 'playwright-version',
    )!;
    const cache = job.steps.find(
      (step) => step.name === 'Cache Playwright browsers',
    )!;
    expect(resolver['working-directory']).toBe('services/platform');
    expect(resolver.run).toContain(
      'require("@playwright/test/package.json").version',
    );
    expect(cache.with).toEqual({
      path: '~/.cache/ms-playwright',
      key: 'playwright-shell-${{ runner.os }}-${{ runner.arch }}-${{ steps.playwright-version.outputs.version }}',
    });
    expect(job.steps.indexOf(resolver)).toBeLessThan(job.steps.indexOf(cache));
    const e2e = await workflow('e2e');
    for (const id of ['e2e', 'static-sites']) {
      const other = e2e.jobs[id];
      expect(
        other.steps.find((step) => step.id === 'playwright-version')?.run,
        id,
      ).toBe(resolver.run);
      expect(
        other.steps.find((step) => step.name === 'Cache Playwright browsers')
          ?.with,
        id,
      ).toEqual(cache.with);
    }
  });

  test('always installs native dependencies and only the used headless shell', async () => {
    const job = (await workflow('checks')).jobs['test-browser'];
    const install = job.steps.find(
      (step) => step.name === 'Install Playwright Chromium',
    )!;
    expect(install.if).toBeUndefined();
    expect(install.run).toContain(
      'bunx playwright install --with-deps --only-shell chromium',
    );
    expect(install.run).toContain('Acquire::http::Timeout "30";');
    expect(install.run).toContain('Acquire::Retries "1";');
    for (const config of [
      'services/platform/vitest.config.ts',
      'packages/ui/vitest.config.ts',
    ]) {
      const source = await readFile(
        new URL(`../../../${config}`, import.meta.url),
        'utf8',
      );
      // An explicit channel requires full Chromium instead of the shell.
      expect(source, config).not.toMatch(/\bchannel\s*:/);
      expect(source, config).toContain('headless: true');
      expect(source, config).toContain('provider: playwright()');
    }
  });
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
  expect(upload.id).toBe('bundle-artifact');
  expect(upload.with?.name).toBe(
    'e2e-platform-dist-attempt-${{ github.run_attempt }}',
  );
  expect(build.outputs?.dist_artifact_id).toBe(
    '${{ steps.bundle-artifact.outputs.artifact-id }}',
  );
  expect(download.with?.['artifact-ids']).toBe(
    '${{ needs.build.outputs.dist_artifact_id }}',
  );
  expect(download.with?.name).toBeUndefined();
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
  const paths = file.on.pull_request.paths ?? [];
  for (const input of [
    'docs/en/self-hosted/install/overview.md',
    'packages/shared/src/utils/session-idle.ts',
    'configs/platform/system/providers/example.yml',
    'tsconfig.dom.json',
    'patches/postgres@3.4.7.patch',
    'bunfig.toml',
  ])
    expect(
      paths.some((pattern) => new Bun.Glob(pattern).match(input)),
      input,
    ).toBe(true);
});
