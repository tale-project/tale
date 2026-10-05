import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { z } from 'zod';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const boundStep = z
  .object({
    runs: z.object({
      steps: z.array(
        z.object({
          name: z.string(),
          if: z.string().optional(),
          run: z.string().optional(),
        }),
      ),
    }),
  })
  .parse(
    parse(
      readFileSync(
        join(REPO_ROOT, '.github/actions/setup-turbo/action.yml'),
        'utf8',
      ),
    ),
  )
  .runs.steps.find((step) => step.name === 'Bound hosted Turbo cache history')!;

function withFixture(proof: (fixture: string) => void) {
  const fixture = mkdtempSync(join(tmpdir(), 'tale-ci-cache-bound-'));
  try {
    writeFileSync(
      join(fixture, 'package.json'),
      JSON.stringify({
        name: 'ci-cache-bound-proof',
        packageManager: 'bun@1.4.2',
        scripts: {
          build: 'bun run build.mjs',
          eviction: 'bun run await-eviction.mjs',
        },
      }),
    );
    writeFileSync(
      join(fixture, 'turbo.json'),
      JSON.stringify({
        tasks: {
          build: {
            inputs: ['build.mjs', 'input.txt', 'fail.txt'],
            outputs: ['dist/**'],
          },
          eviction: { cache: false },
        },
      }),
    );
    writeFileSync(join(fixture, 'input.txt'), 'current output');
    writeFileSync(
      join(fixture, 'build.mjs'),
      `import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
if (existsSync('fail.txt')) {
  writeFileSync('rejection', 'source validation failed');
  throw new Error('source validation failed');
}
mkdirSync('dist', { recursive: true });
writeFileSync('dist/result.txt', readFileSync('input.txt'));
const count = existsSync('executions') ? Number(readFileSync('executions', 'utf8')) : 0;
writeFileSync('executions', String(count + 1));
`,
    );
    writeFileSync(
      join(fixture, 'await-eviction.mjs'),
      `import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
const targets = JSON.parse(readFileSync('eviction-targets.json', 'utf8'));
const deadline = Date.now() + 10_000;
while (targets.some((file) => existsSync(join('.turbo/cache', file)))) {
  if (Date.now() >= deadline) throw new Error('native eviction did not complete');
  await setTimeout(10);
}
`,
    );
    proof(fixture);
  } finally {
    // Only this test's newly created disposable fixture is removed.
    rmSync(fixture, { recursive: true, force: true });
  }
}

function turbo(
  fixture: string,
  maxSize: string,
  awaitEviction = false,
  environment: NodeJS.ProcessEnv = {},
) {
  return spawnSync(
    process.execPath,
    [
      'x',
      'turbo',
      'run',
      'build',
      ...(awaitEviction ? ['eviction'] : []),
      `--cwd=${fixture}`,
      '--cache=local:rw',
      '--output-logs=full',
      '--summarize',
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...environment,
        TURBO_CACHE_DIR: join(fixture, '.turbo/cache'),
        TURBO_CACHE_MAX_SIZE: maxSize,
        TURBO_CACHE_MAX_AGE: '0',
        TURBO_TELEMETRY_DISABLED: '1',
      },
      timeout: 15_000,
    },
  );
}

function buildEvidence(fixture: string) {
  const schema = z.object({
    tasks: z.array(
      z.object({
        taskId: z.string(),
        task: z.string(),
        hash: z.string().regex(/^[a-f0-9]{16}$/),
        cache: z.object({ status: z.enum(['HIT', 'MISS']) }),
        execution: z.object({
          exitCode: z.number().int(),
          error: z.string().optional(),
        }),
      }),
    ),
  });
  const runs = join(fixture, '.turbo/runs');
  return readdirSync(runs)
    .filter((file) => file.endsWith('.json'))
    .flatMap(
      (file) =>
        schema.parse(JSON.parse(readFileSync(join(runs, file), 'utf8'))).tasks,
    )
    .filter((task) => task.task === 'build');
}

function seedHistory(fixture: string, hash: string, ageDays: number) {
  const cache = join(fixture, '.turbo/cache');
  mkdirSync(cache, { recursive: true });
  const old = new Date(Date.now() - ageDays * 86_400_000);
  const targetsFile = join(fixture, 'eviction-targets.json');
  const targets = existsSync(targetsFile)
    ? z.array(z.string()).parse(JSON.parse(readFileSync(targetsFile, 'utf8')))
    : [];
  for (const [suffix, contents] of [
    ['.tar.zst', 'x'.repeat(32 * 1024)],
    ['-meta.json', JSON.stringify({ hash, duration: 1 })],
    ['-manifest.json', '{}'],
  ]) {
    const file = join(cache, `${hash}${suffix}`);
    writeFileSync(file, contents);
    utimesSync(file, old, old);
    targets.push(`${hash}${suffix}`);
  }
  writeFileSync(targetsFile, JSON.stringify(targets));
}

describe('native CI Turbo cache eviction', () => {
  test('only hosted Actions jobs receive an eviction target and checkout-local cache path', () => {
    expect(boundStep.if).toBe("inputs.turbo-cache == 'true'");
    withFixture((fixture) => {
      for (const [actions, environment, bounded] of [
        ['true', 'github-hosted', true],
        ['true', 'self-hosted', false],
        ['', 'github-hosted', false],
        ['', '', false],
      ] as const) {
        const output = join(fixture, 'env');
        writeFileSync(output, '');
        const run = spawnSync('bash', ['-c', boundStep.run!], {
          cwd: fixture,
          encoding: 'utf8',
          env: {
            ...process.env,
            GITHUB_ACTIONS: actions,
            RUNNER_ENVIRONMENT: environment,
            GITHUB_WORKSPACE: fixture,
            GITHUB_ENV: output,
          },
        });
        expect(run.status, run.stderr).toBe(0);
        expect(readFileSync(output, 'utf8')).toBe(
          bounded
            ? `TURBO_CACHE_DIR=${fixture}/.turbo/cache\nTURBO_CACHE_MAX_SIZE=512MB\n`
            : '',
        );
      }
    });
  });

  test('installed Turbo evicts old complete entries and restores current cached outputs', () => {
    withFixture((fixture) => {
      const first = turbo(fixture, '16KB');
      expect(first.status, first.stderr).toBe(0);
      expect(first.stdout).toContain('0 cached, 1 total');
      const cache = join(fixture, '.turbo/cache');
      const current = readdirSync(cache).find((name) =>
        name.endsWith('.tar.zst'),
      )!;
      const currentBytes = readdirSync(cache).reduce(
        (total, name) => total + statSync(join(cache, name)).size,
        0,
      );
      expect(currentBytes).toBeLessThan(16 * 1024);
      seedHistory(fixture, '1111111111111111', 14);
      seedHistory(fixture, '2222222222222222', 7);
      rmSync(join(fixture, 'dist'), { recursive: true });

      // Native eviction uses an unjoined background thread. An uncached
      // fixture sentinel keeps Turbo alive until every seeded file is gone,
      // including on a fast cache hit; no fixed timing assumption is needed.
      const warm = turbo(fixture, '16KB', true);
      expect(warm.status, warm.stderr).toBe(0);
      expect(warm.stdout).toContain('1 cached, 2 total');
      expect(readFileSync(join(fixture, 'executions'), 'utf8')).toBe('1');
      expect(readFileSync(join(fixture, 'dist/result.txt'), 'utf8')).toBe(
        'current output',
      );
      expect(existsSync(join(cache, current))).toBe(true);
      for (const hash of ['1111111111111111', '2222222222222222']) {
        for (const suffix of ['.tar.zst', '-meta.json', '-manifest.json']) {
          expect(existsSync(join(cache, `${hash}${suffix}`))).toBe(false);
        }
      }
    });
  });

  test('an oversized restored entry is removed with its sidecars and new task writes remain valid', () => {
    withFixture((fixture) => {
      const hash = '3333333333333333';
      seedHistory(fixture, hash, 1);
      const run = turbo(fixture, '16KB', true);
      expect(run.status, run.stderr).toBe(0);
      const cache = join(fixture, '.turbo/cache');
      for (const suffix of ['.tar.zst', '-meta.json', '-manifest.json']) {
        expect(existsSync(join(cache, `${hash}${suffix}`))).toBe(false);
      }
      expect(readFileSync(join(fixture, 'dist/result.txt'), 'utf8')).toBe(
        'current output',
      );
    });
  });

  for (const [name, environment] of [
    ['local', { CI: '', GITHUB_ACTIONS: '' }],
    ['hosted Actions', { CI: '1', GITHUB_ACTIONS: 'true' }],
  ] as const) {
    test(`native size parsing rejects invalid units and cannot hide a changed failing task (${name})`, () => {
      withFixture((fixture) => {
        const invalid = turbo(fixture, '512MiB', false, environment);
        expect(invalid.status).not.toBe(0);
        expect(invalid.stderr).toContain('unknown unit');
        expect(existsSync(join(fixture, 'executions'))).toBe(false);
        const good = turbo(fixture, '512MB', false, environment);
        expect(good.status, good.stderr).toBe(0);
        const cache = join(fixture, '.turbo/cache');
        const published = readdirSync(cache).filter((file) =>
          file.endsWith('.tar.zst'),
        );
        expect(published).toHaveLength(1);
        const archiveName = z.string().parse(published[0]);
        const archive = readFileSync(join(cache, archiveName));
        const passed = buildEvidence(fixture);
        expect(passed).toHaveLength(1);
        expect(passed[0]?.cache.status).toBe('MISS');
        expect(passed[0]?.execution.exitCode).toBe(0);
        expect(existsSync(join(fixture, 'rejection'))).toBe(false);
        writeFileSync(join(fixture, 'fail.txt'), 'reject changed source');
        const bad = turbo(fixture, '512MB', false, environment);
        expect(bad.status, bad.stdout + bad.stderr).toBe(1);
        const evidence = buildEvidence(fixture);
        expect(evidence).toHaveLength(2);
        const failures = evidence.filter(
          (task) => task.execution.exitCode !== 0,
        );
        expect(failures).toHaveLength(1);
        const failed = failures[0]!;
        expect(failed.taskId).toBe(passed[0]?.taskId);
        expect(failed.cache.status).toBe('MISS');
        expect(failed.hash).not.toBe(passed[0]?.hash);
        expect(failed.execution.exitCode).toBe(1);
        expect(failed.execution.error).toContain('exited (1)');
        expect(readFileSync(join(fixture, 'rejection'), 'utf8')).toBe(
          'source validation failed',
        );
        expect(bad.stdout).toContain('cache miss, executing');
        expect(bad.stdout).toContain('0 cached, 1 total');
        // CI console adapters can omit the failed task's buffered error body.
        // Its actual per-task log still records the same validation failure.
        expect(
          readFileSync(join(fixture, '.turbo/turbo-build.log'), 'utf8'),
        ).toContain('source validation failed');
        expect(readFileSync(join(fixture, 'executions'), 'utf8')).toBe('1');
        // Failed work cannot publish an archive or replace a previous success.
        expect(
          readdirSync(cache).filter((file) => file.endsWith('.tar.zst')),
        ).toEqual(published);
        expect(readFileSync(join(cache, archiveName))).toEqual(archive);
      });
    });
  }
});
