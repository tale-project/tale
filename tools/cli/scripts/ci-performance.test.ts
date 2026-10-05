import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

import { parse } from 'yaml';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
type Step = {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  'working-directory'?: string;
};
type Job = {
  name?: string;
  env?: Record<string, string>;
  needs?: string | string[];
  steps?: Step[];
  strategy?: {
    'fail-fast'?: boolean;
    matrix?: { shard?: number[] };
  };
};
const workflow = async (name: string) =>
  parse(
    await readFile(
      join(repository, '.github/workflows', `${name}.yml`),
      'utf8',
    ),
  ) as {
    jobs: Record<string, Job>;
    env?: Record<string, string>;
    on?: { pull_request?: { paths?: string[] } };
  };

describe('bounded test parallelism', () => {
  test('every browser lane caches its installed revision and still provisions native dependencies', async () => {
    for (const [file, id, directory] of [
      ['checks', 'test-browser', 'services/platform'],
      ['e2e', 'e2e', 'services/platform'],
      ['e2e', 'static-sites', 'services/${{ matrix.service }}'],
    ]) {
      const steps = (await workflow(file!)).jobs[id!]!.steps!;
      const version = steps.find((step) => step.id === 'playwright-version')!;
      const cache = steps.find(
        (step) => step.name === 'Cache Playwright browsers',
      )!;
      const install = steps.find(
        (step) => step.name === 'Install Playwright Chromium',
      )!;
      expect(version.run).toContain('set -euo pipefail');
      expect(version.run).toContain(
        'require("@playwright/test/package.json").version',
      );
      // bunx resolves the CLI from its working directory, so the cache
      // resolver must query the package installed by that same command.
      expect(version['working-directory']).toBe(directory);
      expect(install['working-directory']).toBe(directory);
      expect(cache.with?.key).toBe(
        'playwright-shell-${{ runner.os }}-${{ runner.arch }}-${{ steps.playwright-version.outputs.version }}',
      );
      expect(cache.with?.['restore-keys']).toBeUndefined();
      expect(steps.indexOf(version)).toBeLessThan(steps.indexOf(cache));
      expect(install.if).toBeUndefined();
      expect(install.run).toContain(
        'playwright install --with-deps --only-shell chromium',
      );
    }
  });

  test('E2E pull requests cover the shared sources and toolchain its builds consume', async () => {
    const paths = (await workflow('e2e')).on?.pull_request?.paths ?? [];
    for (const input of [
      'packages/shared/src/schemas/org.ts',
      'configs/platform/system/providers/example.yml',
      'docs/en/self-hosted/install/overview.md',
      'patches/postgres@3.4.7.patch',
      'bunfig.toml',
      'tsconfig.dom.json',
    ])
      expect(
        paths.some((pattern) => new Bun.Glob(pattern).match(input)),
        input,
      ).toBe(true);
  });

  test('UI preserves the standard check and requires all four cached shards', async () => {
    const { jobs } = await workflow('checks');
    const gate = jobs['test-ui']!;
    const shards = jobs['test-ui-shards']!;
    expect(gate.name).toBe('UI');
    expect(gate.needs).toEqual(['candidate-source', 'test-ui-shards']);
    expect(gate.steps).toHaveLength(1);
    expect(gate.steps![0]!.env?.SHARDS_RESULT).toBe(
      '${{ needs.test-ui-shards.result }}',
    );
    expect(shards.name).toBe('UI (platform ${{ matrix.shard }}/4)');
    expect(shards.strategy).toEqual({
      'fail-fast': false,
      matrix: { shard: [1, 2, 3, 4] },
    });
    expect(
      shards.steps?.find((step) => step.run?.includes('test:ui'))?.run,
    ).toBe(
      'bunx turbo run test:ui --filter=@tale/platform --output-logs=errors-only --summarize -- --shard=${{ matrix.shard }}/4',
    );
    expect([jobs['candidate-gate']!.needs].flat()).toContain('test-ui-shards');
  });

  test
    .skipIf(process.platform === 'win32')
    .each(['success', 'failure', 'cancelled', 'skipped', ''])(
    'the standard UI gate fails closed for matrix result %s',
    async (result) => {
      const gate = (await workflow('checks')).jobs['test-ui']!;
      const child = Bun.spawn(['bash', '-c', gate.steps![0]!.run!], {
        env: { ...process.env, SHARDS_RESULT: result },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(code, stdout + stderr).toBe(result === 'success' ? 0 : 1);
    },
  );

  test('platform E2E uses four independent single-worker stacks and one bundle', async () => {
    const { jobs, env } = await workflow('e2e');
    const build = jobs.build!;
    const shards = jobs.e2e!;
    expect(shards.strategy).toEqual({
      'fail-fast': false,
      matrix: { shard: [1, 2, 3, 4] },
    });
    const run = shards.steps!.find((step) =>
      step.run?.includes('playwright test'),
    )!;
    expect(run.run).toBe(
      'bunx playwright test --shard=${{ matrix.shard }}/${{ strategy.job-total }}',
    );
    expect(run.env).toMatchObject({
      E2E_WORKERS: '1',
      TALE_E2E_SERVE_BUILD: '1',
    });
    expect(run['working-directory']).toBe('services/platform');
    expect(
      shards.steps?.some((step) =>
        /bun (?:run |--bun )?build/.test(step.run ?? ''),
      ),
    ).toBe(false);
    expect(build.steps?.some((step) => step.id === 'dist-cache')).toBe(false);
    expect(
      build.steps?.find((step) => step.run?.includes('turbo run build'))?.run,
    ).toBe('bunx turbo run build --filter=@tale/platform');
    const buildSetup = build.steps!.find(
      (step) => step.uses === './.github/actions/setup-turbo',
    )!;
    expect(buildSetup.with?.['start-turbo-cache']).toBe('false');
    expect(buildSetup.with?.['turbo-cache']).not.toBe('false');
    expect(buildSetup.with?.['cache-scope']).toBe('build');
    const runtimeSetup = shards.steps!.find(
      (step) => step.uses === './.github/actions/setup-turbo',
    )!;
    expect(runtimeSetup.with?.['turbo-cache']).toBe('false');
    expect(env).toBeUndefined();
    for (const file of ['checks', 'e2e']) {
      const config = await workflow(file);
      for (const environment of [
        config.env,
        ...Object.values(config.jobs).map((job) => job.env),
      ]) {
        expect(environment?.TURBO_API).toBeUndefined();
        expect(environment?.TURBO_TOKEN).toBeUndefined();
        expect(environment?.TURBO_TEAM).toBeUndefined();
      }
      for (const job of Object.values(config.jobs)) {
        for (const setup of job.steps ?? []) {
          if (setup.uses === './.github/actions/setup-turbo')
            expect(setup.with?.['start-turbo-cache']).toBe('false');
        }
      }
    }
    const upload = build.steps?.find((step) =>
      step.uses?.startsWith('actions/upload-artifact@'),
    );
    const download = shards.steps?.find((step) =>
      step.uses?.startsWith('actions/download-artifact@'),
    );
    expect(upload?.with).toMatchObject({
      name: 'e2e-platform-dist-attempt-${{ github.run_attempt }}',
      'if-no-files-found': 'error',
      'compression-level': 0,
    });
    expect(download?.with?.['artifact-ids']).toBe(
      '${{ needs.build.outputs.dist_artifact_id }}',
    );
    expect(download?.with?.name).toBeUndefined();
    expect(download?.with?.path).toBe(upload?.with?.path);
  });
});

describe('static-site build reuse', () => {
  test('both smoke suites restore the full production build and web SEO still runs after an E2E failure', async () => {
    const job = (await workflow('e2e')).jobs['static-sites']!;
    const steps = job.steps!;
    const build = steps.find((step) => step.id === 'site-build')!;
    const smoke = steps.find((step) => step.run?.includes('test:e2e'))!;
    const seo = steps.find(
      (step) => step.name === 'Prerender SEO suite (web)',
    )!;
    expect(build.run).toBe(
      'bunx turbo run build --filter=@tale/${{ matrix.service }}',
    );
    expect(build.env?.GITHUB_TOKEN).toBe('${{ secrets.GITHUB_TOKEN }}');
    expect(steps.indexOf(build)).toBeLessThan(steps.indexOf(smoke));
    expect(smoke.env?.E2E_USE_BUILD).toBe('1');
    expect(seo.run).toBe('bunx turbo run test:prerender --filter=@tale/web');
    expect(seo.if).toContain('!cancelled()');
    expect(seo.if).toContain("steps.site-build.outcome == 'success'");
    expect(seo.if).toContain("matrix.service == 'web'");
    const setup = job.steps!.find(
      (step) => step.uses === './.github/actions/setup-turbo',
    )!;
    expect(setup.with).toMatchObject({
      'start-turbo-cache': 'false',
      'turbo-cache': 'true',
      'cache-scope': 'build',
      'cache-writer': 'static-${{ matrix.service }}',
    });
  });

  test.each(['web', 'docs'])(
    '%s skips only its build when explicitly supplied a bundle',
    async (service) => {
      const configUrl = pathToFileURL(
        join(repository, 'services', service, 'playwright.config.ts'),
      ).href;
      // Execute the config's own options without booting Playwright's runtime
      // six times in the unit suite. The shared config factory has its own
      // tests; this boundary owns the build/preview command and CI reuse.
      const source = await readFile(fileURLToPath(configUrl), 'utf8');
      const script = new Bun.Transpiler({ loader: 'ts' })
        .transformSync(source)
        .replace(/^import .*;$/gm, '')
        .replaceAll('import.meta.url', JSON.stringify(configUrl))
        .replace('export default ', 'globalThis.options = ');
      for (const reuse of ['1', '', 'true']) {
        const options = runInNewContext(
          `${script}\noptions;`,
          {
            process: { env: { E2E_USE_BUILD: reuse, CI: '1' } },
            fileURLToPath,
            URL,
            createPlaywrightConfig: (config: unknown) => config,
          },
          { timeout: 1000 },
        ) as {
          webServer: { command: string; reuseExistingServer: boolean };
        };
        const server = options.webServer;
        expect(server.reuseExistingServer).toBe(false);
        expect(server.command).toContain('vite preview');
        expect(server.command).toContain('--strictPort');
        if (reuse === '1') {
          expect(server.command).not.toContain('build');
        } else {
          expect(server.command).toContain(
            service === 'web' ? 'vite build' : 'scripts/build-client.ts',
          );
          if (service === 'docs')
            expect(server.command).toContain('scripts/build-search-index.ts');
        }
      }
    },
  );
});
