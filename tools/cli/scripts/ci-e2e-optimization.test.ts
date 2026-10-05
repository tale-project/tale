import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { parse } from 'yaml';

type Step = {
  id?: string;
  name?: string;
  run?: string;
  if?: string;
  uses?: string;
  'working-directory'?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  'continue-on-error'?: boolean;
};
type Job = {
  outputs?: Record<string, string>;
  name?: string;
  needs?: string[] | string;
  if?: string;
  strategy?: {
    'fail-fast'?: boolean;
    matrix?: { shard?: number[]; service?: string };
  };
  steps?: Step[];
};
type Workflow = {
  on: { pull_request: { paths: string[] } };
  jobs: Record<string, Job>;
};

const repository = fileURLToPath(new URL('../../..', import.meta.url));
const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const workflow = async (stem: string) =>
  parse(
    await readFile(
      join(repository, '.github/workflows', `${stem}.yml`),
      'utf8',
    ),
  ) as Workflow;
const step = (job: Job | undefined, name: string) => {
  const found = job?.steps?.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing CI step: ${name}`);
  return found;
};
const matches = (globs: string[], path: string) =>
  globs.some((pattern) => new Bun.Glob(pattern).match(path));

async function decide(environment: Record<string, string>) {
  const script = step((await workflow('e2e')).jobs.scope, 'Decide').run;
  if (!script) throw new Error('Missing E2E scope script');
  const directory = await mkdtemp(join(tmpdir(), 'tale-ci-e2e-'));
  temporary.push(directory);
  const output = join(directory, 'output');
  await writeFile(output, '');
  const child = Bun.spawn(['bash', '-c', script], {
    cwd: directory,
    env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...environment },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr, output: await readFile(output, 'utf8') };
}

describe('E2E service scheduling', () => {
  test.skipIf(process.platform === 'win32')(
    'the actual PR scope script selects every combination of changed services',
    async () => {
      for (const platform of ['true', 'false'])
        for (const web of ['true', 'false'])
          for (const docs of ['true', 'false']) {
            const result = await decide({
              EVENT_NAME: 'pull_request',
              PLATFORM: platform,
              WEB: web,
              DOCS: docs,
            });
            expect(result.code, result.stderr).toBe(0);
            const services = [
              ...(web === 'true' ? ['web'] : []),
              ...(docs === 'true' ? ['docs'] : []),
            ];
            expect(result.output).toBe(
              `platform=${platform}\nstatic_services=${JSON.stringify(services)}\n`,
            );
          }
    },
  );

  test.skipIf(process.platform === 'win32')(
    'candidate, nightly and manual runs always execute every service without a PR diff',
    async () => {
      for (const event of [
        'repository_dispatch',
        'schedule',
        'workflow_dispatch',
      ]) {
        const result = await decide({ EVENT_NAME: event });
        expect(result.code, result.stderr).toBe(0);
        expect(result.output).toBe(
          'platform=true\nstatic_services=["web","docs"]\n',
        );
      }
    },
  );

  test.skipIf(process.platform === 'win32')(
    'missing or malformed PR scope fails before publishing scheduling outputs',
    async () => {
      for (const key of ['PLATFORM', 'WEB', 'DOCS'])
        for (const value of ['', 'yes', 'true\n', 'false; exit 0']) {
          const result = await decide({
            EVENT_NAME: 'pull_request',
            PLATFORM: 'true',
            WEB: 'false',
            DOCS: 'false',
            [key]: value,
          });
          expect(result.code).not.toBe(0);
          expect(result.output).toBe('');
        }
    },
  );

  test('service and shared source edits trigger and select the suites that consume them', async () => {
    const file = await workflow('e2e');
    const filters = parse(
      String(step(file.jobs.scope, 'Filter paths').with?.filters),
    ) as Record<string, string[]>;
    const cases: [string, string[]][] = [
      ['services/platform/tests/e2e/specs/chat.spec.ts', ['platform']],
      ['services/platform/backend/main.ts', ['platform']],
      ['services/platform/index.html', ['platform']],
      ['services/platform/app/routes/index.tsx', ['platform']],
      ['services/platform/vite-plugins/inject-boot-shell.ts', ['platform']],
      ['services/platform/scripts/prerender-boot-shell.tsx', ['platform']],
      ['services/platform/public/assets/logo.svg', ['platform']],
      ['configs/platform/custom/agents/assistant.json', ['platform']],
      ['services/platform/messages/en.yml', ['platform']],
      ['configs/platform/system/harnesses/example.yml', ['platform']],
      ['services/sandbox-runtime/daemon/src/file-ops.ts', ['platform']],
      ['tools/cli/src/lib/compose/types.ts', ['platform']],
      ['scripts/ensure-sandbox-runtime-image.ts', ['platform']],
      ['compose.sandbox-llm-gateway.dev.yml', ['platform']],
      ['services/web/playwright.config.ts', ['web']],
      ['services/docs/scripts/build-search-index.ts', ['docs']],
      ['docs/fr/self-hosted/install/overview.md', ['docs']],
      ...[
        'packages/ui/src/pwa/vite-plugin.ts',
        'packages/ui/tailwind-preset.ts',
        'packages/ui/src/components/button.tsx',
        'packages/marketing-ui/src/index.ts',
        'packages/shared/src/utils/site-urls.ts',
        'packages/shared/src/schemas/provider.ts',
        'packages/e2e/src/config.ts',
        'patches/postgres@3.4.7.patch',
        'package.json',
        'bun.lock',
        'bunfig.toml',
        'turbo.json',
        'tsconfig.dom.json',
        'tsconfig.vite.json',
        '.github/actions/setup-turbo/action.yml',
        '.github/workflows/e2e.yml',
      ].map((path): [string, string[]] => [path, ['docs', 'platform', 'web']]),
    ];
    for (const [path, expected] of cases) {
      expect(matches(file.on.pull_request.paths, path), path).toBe(true);
      expect(
        Object.entries(filters)
          .filter(([, globs]) => matches(globs, path))
          .map(([service]) => service)
          .toSorted(),
        path,
      ).toEqual(expected.toSorted());
    }
  });

  test('four complete single-worker shards share one build and static sites avoid it', async () => {
    const file = await workflow('e2e');
    const shards = file.jobs.e2e!.strategy!.matrix!.shard!;
    expect(shards).toEqual(Array.from({ length: 4 }, (_, index) => index + 1));
    expect(file.jobs.e2e?.strategy?.['fail-fast']).toBe(false);
    expect(
      step(
        file.jobs.e2e,
        'Run E2E suite (shard ${{ matrix.shard }}/${{ strategy.job-total }})',
      ),
    ).toMatchObject({
      run: 'bunx playwright test --shard=${{ matrix.shard }}/${{ strategy.job-total }}',
      env: { E2E_WORKERS: '1', TALE_E2E_SERVE_BUILD: '1' },
    });
    expect(file.jobs.build?.if).toContain(
      "needs.scope.outputs.platform == 'true'",
    );
    expect(file.jobs['static-sites']?.needs).toEqual([
      'candidate-source',
      'scope',
    ]);
    expect(file.jobs['static-sites']?.strategy?.matrix?.service).toBe(
      '${{ fromJSON(needs.scope.outputs.static_services) }}',
    );
    expect(file.jobs['static-sites']?.if).toContain(
      "needs.scope.outputs.static_services != '[]'",
    );
    expect(file.jobs['candidate-gate']?.needs).toContain('scope');
    expect(step(file.jobs['static-sites'], 'Run E2E suite').run).toBe(
      'bun run --filter @tale/${{ matrix.service }} test:e2e --workers=2',
    );
    const upload = step(file.jobs.build, 'Upload platform dist for the shards');
    expect(upload.with).toMatchObject({
      name: 'e2e-platform-dist-attempt-${{ github.run_attempt }}',
      path: 'services/platform/dist',
      'compression-level': 0,
      'if-no-files-found': 'error',
      'retention-days': 7,
    });
    const download = step(
      file.jobs.e2e,
      'Download platform dist (built once by the build job)',
    );
    expect(upload.id).toBe('bundle-artifact');
    expect(file.jobs.build?.outputs?.dist_artifact_id).toBe(
      '${{ steps.bundle-artifact.outputs.artifact-id }}',
    );
    expect(download.with).toEqual({
      'artifact-ids': '${{ needs.build.outputs.dist_artifact_id }}',
      path: upload.with?.path,
    });
    const validate = step(
      file.jobs.e2e,
      'Validate platform bundle artifact identity',
    );
    expect(download.with?.['artifact-ids']).toBe(
      validate.env?.DIST_ARTIFACT_ID,
    );
    expect(file.jobs.e2e!.steps!.indexOf(validate)).toBeLessThan(
      file.jobs.e2e!.steps!.indexOf(download),
    );
  });

  test('preview reuses the declared build task while Playwright cache lanes stay isolated', async () => {
    const file = await workflow('e2e');
    expect(step(file.jobs.build, 'Setup toolchain').with).toMatchObject({
      'cache-scope': 'build',
      'start-turbo-cache': 'false',
      'github-token': '${{ secrets.GITHUB_TOKEN }}',
    });
    expect(
      step(file.jobs.build, 'Setup toolchain').with?.['turbo-cache'],
    ).not.toBe('false');
    const build = step(
      file.jobs.build,
      'Build platform (prod bundle for E2E preview)',
    );
    expect(build.run).toBe('bunx turbo run build --filter=@tale/platform');
    expect(build.if).toBeUndefined();
    expect(
      file.jobs.build?.steps?.some(
        (entry) =>
          entry.id === 'dist-cache' ||
          (entry.with?.path === 'services/platform/dist' &&
            entry.uses?.startsWith('actions/cache@')),
      ),
    ).toBe(false);
    expect(step(file.jobs.e2e, 'Setup toolchain').with).toMatchObject({
      'turbo-cache': 'false',
      'start-turbo-cache': 'false',
      'github-token': '${{ secrets.GITHUB_TOKEN }}',
    });
    expect(
      step(file.jobs['static-sites'], 'Setup toolchain').with,
    ).toMatchObject({
      'turbo-cache': "${{ github.event_name != 'repository_dispatch' }}",
      'cache-scope': 'build',
      'cache-writer': 'static-${{ matrix.service }}',
      'start-turbo-cache': 'false',
      'github-token': '${{ secrets.GITHUB_TOKEN }}',
    });
    expect(
      step(file.jobs['static-sites'], 'Prerender SEO suite (web)').run,
    ).toContain('bun run --filter @tale/web test:prerender');
  });

  test('web SEO requires the completed build and still inspects it after browser failure', async () => {
    const job = (await workflow('e2e')).jobs['static-sites']!;
    const steps = job.steps!;
    const build = step(job, 'Build static site');
    const browser = step(job, 'Run E2E suite');
    const seo = step(job, 'Prerender SEO suite (web)');
    expect(build.id).toBe('site-build');
    expect(steps.indexOf(build)).toBeLessThan(steps.indexOf(browser));
    expect(steps.indexOf(browser)).toBeLessThan(steps.indexOf(seo));
    // A status function prevents GitHub's implicit success() from suppressing
    // this step when Playwright fails; failed or missing builds remain barred.
    expect(seo.if).toMatch(/\b(?:always|cancelled|success|failure)\s*\(/);
    const condition = seo.if!.replace(
      'steps.site-build',
      "steps['site-build']",
    );
    for (const service of ['web', 'docs'])
      for (const outcome of ['success', 'failure', 'cancelled', 'skipped', ''])
        for (const browserOutcome of ['success', 'failure'])
          for (const cancelled of [false, true]) {
            const admitted = runInNewContext(condition, {
              matrix: { service },
              steps: { 'site-build': { outcome } },
              cancelled: () => cancelled,
              success: () =>
                outcome === 'success' && browserOutcome === 'success',
              failure: () =>
                outcome === 'failure' || browserOutcome === 'failure',
              always: () => true,
            });
            expect(
              admitted,
              `${service}/${outcome}/${browserOutcome}/${cancelled}`,
            ).toBe(service === 'web' && outcome === 'success' && !cancelled);
          }
  });

  test.each([
    ['e2e', 'e2e'],
    ['e2e', 'static-sites'],
    ['checks', 'test-browser'],
  ])(
    '%s/%s caches the installed browser version and always installs native dependencies',
    async (stem, job) => {
      const file = await workflow(stem);
      const steps = file.jobs[job]!.steps!;
      const version = step(file.jobs[job], 'Resolve Playwright version');
      expect(
        steps.filter((entry) => entry.id === 'playwright-version'),
      ).toHaveLength(1);
      expect(version.run).toContain(
        'require("@playwright/test/package.json").version',
      );
      // Assignment must fail before echo if version resolution fails. An echo
      // wrapping the substitution swallows the command's failed exit status.
      expect(version.run).toMatch(/^set -euo pipefail\nversion="\$\(bun /);
      expect(version['working-directory']).toBe(
        job === 'static-sites'
          ? 'services/${{ matrix.service }}'
          : 'services/platform',
      );
      const browserCache = step(file.jobs[job], 'Cache Playwright browsers');
      expect(browserCache.with?.key).toBe(
        'playwright-shell-${{ runner.os }}-${{ runner.arch }}-${{ steps.playwright-version.outputs.version }}',
      );
      expect(browserCache.with?.['restore-keys']).toBeUndefined();
      const install = step(file.jobs[job], 'Install Playwright Chromium');
      expect(install.if).toBeUndefined();
      expect(install.run).toContain(
        'playwright install --with-deps --only-shell chromium',
      );
      expect(steps.indexOf(version)).toBeLessThan(steps.indexOf(browserCache));
    },
  );

  test.skipIf(process.platform === 'win32')(
    'browser version lookup propagates failure instead of restoring an empty key',
    async () => {
      for (const [stem, job] of [
        ['e2e', 'e2e'],
        ['e2e', 'static-sites'],
        ['checks', 'test-browser'],
      ] as const) {
        const file = await workflow(stem);
        const script = step(file.jobs[job], 'Resolve Playwright version').run!;
        for (const [mock, exitCode, output] of [
          ["printf '1.58.2'", 0, 'version=1.58.2\n'],
          ['return 19', 19, ''],
          ["printf '1.58.2'; return 19", 19, ''],
          ["printf ''", 1, ''],
          ["printf 'malformed'", 1, ''],
          ["printf '1.58.2\\n1.59.0'", 1, ''],
        ] as const) {
          const directory = await mkdtemp(join(tmpdir(), 'tale-ci-browser-'));
          temporary.push(directory);
          const versionOutput = join(directory, 'output');
          await writeFile(versionOutput, '');
          const result = Bun.spawnSync(
            ['bash', '-c', `bun() { ${mock}; }\n${script}`],
            {
              env: { ...process.env, GITHUB_OUTPUT: versionOutput },
              stdout: 'pipe',
              stderr: 'pipe',
            },
          );
          expect(result.exitCode, mock).toBe(exitCode);
          expect(await readFile(versionOutput, 'utf8'), mock).toBe(output);
        }
      }
    },
  );

  test.skipIf(process.platform === 'win32')(
    'version resolution reads the actual installed Playwright package',
    async () => {
      const resolve = step(
        (await workflow('e2e')).jobs.e2e,
        'Resolve Playwright version',
      );
      if (!resolve.run || !resolve['working-directory'])
        throw new Error('Missing service-local Playwright version resolution');
      const directory = await mkdtemp(join(tmpdir(), 'tale-ci-playwright-'));
      temporary.push(directory);
      const output = join(directory, 'output');
      await writeFile(output, '');
      const child = Bun.spawn(['bash', '-c', resolve.run], {
        cwd: join(repository, resolve['working-directory']),
        env: { PATH: process.env.PATH, GITHUB_OUTPUT: output },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [code, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(code, stderr).toBe(0);
      const { version } = JSON.parse(
        await readFile(
          join(repository, 'node_modules/@playwright/test/package.json'),
          'utf8',
        ),
      ) as { version: string };
      expect(await readFile(output, 'utf8')).toBe(`version=${version}\n`);
    },
  );
});

test('SAST verifies reporting and blocking behavior on its provisioned engine', async () => {
  const sast = await workflow('sast');
  const job = sast.jobs.sast;
  const setup = step(job, 'Setup Bun for scanner regressions');
  const scan = step(job, 'Run Opengrep');
  const regression = step(
    job,
    'Verify scanner reporting and blocking behavior',
  );
  expect(setup.with?.['bun-version']).toBe('1.4.2');
  expect(setup.if).toBe("hashFiles('tools/opengrep/run.test.ts') != ''");
  expect(regression.run).toBe('bun test tools/opengrep/run.test.ts');
  expect(regression.if).toBe(
    "always() && !cancelled() && hashFiles('tools/opengrep/run.test.ts') != ''",
  );
  expect(regression['continue-on-error']).not.toBe(true);
  expect(job.steps?.indexOf(setup)).toBeLessThan(
    job.steps?.indexOf(scan) ?? -1,
  );
  expect(job.steps?.indexOf(scan)).toBeLessThan(
    job.steps?.indexOf(regression) ?? -1,
  );
});

test('candidate scans retain blocking policies without publishing SARIF', async () => {
  const sast = await workflow('sast');
  const scan = step(sast.jobs.sast, 'Run Opengrep');
  const expression = scan.env?.OPENGREP_SARIF_OUTPUT?.replace(
    /^\$\{\{\s*|\s*\}\}$/g,
    '',
  );
  expect(expression).toBeDefined();
  for (const event of [
    'repository_dispatch',
    'pull_request',
    'push',
    'schedule',
  ]) {
    expect(
      runInNewContext(expression!, { github: { event_name: event } }),
    ).toBe(event === 'repository_dispatch' ? '' : 'opengrep.sarif');
  }
  expect(scan.run).toContain('bash tools/opengrep/run.sh');
  const security = await workflow('security');
  const report = step(security.jobs['trivy-fs'], 'Run Trivy filesystem scan');
  expect(report.if).toBe("github.event_name != 'repository_dispatch'");
  for (const event of [
    'repository_dispatch',
    'pull_request',
    'push',
    'schedule',
  ])
    expect(runInNewContext(report.if!, { github: { event_name: event } })).toBe(
      event !== 'repository_dispatch',
    );
  const gate = step(
    security.jobs['trivy-fs'],
    'Trivy vulnerability gate (HIGH/CRITICAL)',
  );
  expect(gate.if).toBeUndefined();
  expect(gate.with).toMatchObject({
    'exit-code': '1',
    severity: 'HIGH,CRITICAL',
    scanners: 'vuln',
    'ignore-unfixed': true,
    trivyignores: '.trivyignore.yaml',
  });
});

async function execute(
  cmd: string[],
  cwd: string,
  env: Record<string, string> = {},
) {
  const child = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

describe('E2E artifact and browser provenance', () => {
  test.skipIf(process.platform === 'win32').each([
    ['123456', true],
    ['', false],
    ['0', false],
    ['123,456', false],
    ['123\n456', false],
    ['wrong', false],
  ] as const)(
    'bundle download admits only one immutable artifact ID: %s',
    async (id, valid) => {
      const validate = step(
        (await workflow('e2e')).jobs.e2e!,
        'Validate platform bundle artifact identity',
      );
      const result = await execute(
        ['bash', '-e', '-c', validate.run!],
        repository,
        {
          DIST_ARTIFACT_ID: id,
        },
      );
      expect(result.code === 0, result.stderr).toBe(valid);
      if (!valid)
        expect(result.stdout).toContain(
          '::error::The platform build reported no valid bundle artifact ID',
        );
    },
  );

  test.each([
    'packages/e2e/src/config.ts',
    'services/platform/playwright.config.ts',
    'services/web/playwright.config.ts',
    'services/docs/playwright.config.ts',
  ])(
    '%s uses headless Chromium without a full-browser channel',
    async (path) => {
      const source = await readFile(join(repository, path), 'utf8');
      expect(source).not.toMatch(/\bchannel\s*:/);
      expect(source).not.toMatch(/\bheadless\s*:\s*false\b/);
      for (const preset of source.matchAll(/\bdevices\[['"]([^'"]+)['"]\]/g))
        expect(preset[1]).toBe('Desktop Chrome');
      for (const browser of source.matchAll(
        /\bbrowserName\s*:\s*['"]([^'"]+)['"]/g,
      ))
        expect(browser[1]).toBe('chromium');
      // The platform supplies its Desktop Chrome project; static sites inherit
      // this factory's Chromium project. Resolve the real config with Playwright
      // --list when changing the project shape; don't load Playwright into every
      // CLI unit run merely to inspect these declarative settings.
      if (path.startsWith('packages/'))
        expect(source).toContain(
          "{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }",
        );
      else expect(source).toContain('createPlaywrightConfig({');
    },
  );
});
