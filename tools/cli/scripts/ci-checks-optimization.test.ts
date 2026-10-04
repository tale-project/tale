import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { z } from 'zod';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
type Step = {
  name?: string;
  id?: string;
  run?: string;
  uses?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  'working-directory'?: string;
};
type Job = {
  name?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  'timeout-minutes'?: number;
  steps?: Step[];
  strategy?: {
    'fail-fast'?: boolean;
    matrix?: { shard?: number[] };
  };
};
const workflow = async () =>
  parse(
    await readFile(join(repository, '.github/workflows/checks.yml'), 'utf8'),
  ) as { jobs: Record<string, Job> };
const dryRunSchema = z.object({
  tasks: z.array(
    z.object({
      taskId: z.string(),
      hash: z.string(),
      command: z.string(),
      cliArguments: z.array(z.string()),
    }),
  ),
});

describe('Checks execution optimizations', () => {
  test('platform UI shards have distinct verdicts while every other UI workspace runs once', async () => {
    const job = (await workflow()).jobs['test-ui-shards']!;
    expect(job.strategy?.['fail-fast']).toBe(false);
    const shards = job.strategy?.matrix?.shard;
    expect(shards).toEqual([1, 2, 3, 4]);
    expect(job.name).toBe('UI (platform ${{ matrix.shard }}/4)');
    const script = job.steps?.find((step) => step.name === 'Run UI tests')?.run;
    if (!script || !shards) throw new Error('The UI shard command is missing');

    const hashes = new Map<string, Set<string>>();
    const resolve = (command: string) => {
      // Ask the actual pinned Turbo CLI to resolve the workflow command;
      // changing a flag's position must not let shards share a cached pass.
      const [runner, ...args] = command
        .trim()
        .split(/\s+/)
        .map((argument) => argument.replace(/(^|=)(['"])(.*)\2$/, '$1$3'));
      expect(runner).toBe('bunx');
      const separator = args.indexOf('--');
      args.splice(
        separator < 0 ? args.length : separator,
        0,
        '--dry=json',
        '--cache=local:,remote:',
      );
      const run = Bun.spawnSync([process.execPath, 'x', ...args], {
        cwd: repository,
      });
      expect(run.exitCode, run.stderr.toString()).toBe(0);
      const stdout = run.stdout.toString();
      const { tasks } = dryRunSchema.parse(
        JSON.parse(stdout.slice(stdout.indexOf('{'))),
      );
      return tasks.filter(
        (task) =>
          task.taskId.endsWith('#test:ui') && task.command !== '<NONEXISTENT>',
      );
    };
    for (const shard of shards) {
      const executed = resolve(
        script.replaceAll('${{ matrix.shard }}', String(shard)),
      );
      expect(executed.map((task) => task.taskId)).toEqual([
        '@tale/platform#test:ui',
      ]);
      for (const task of executed) {
        expect(task.command, task.taskId).toContain('vitest');
        expect(task.cliArguments).toEqual([`--shard=${shard}/4`]);
        const taskHashes = hashes.get(task.taskId) ?? new Set<string>();
        taskHashes.add(task.hash);
        hashes.set(task.taskId, taskHashes);
      }
    }
    for (const taskHashes of hashes.values())
      expect(taskHashes.size).toBe(shards.length);
    const otherStep = job.steps?.find(
      (step) => step.name === 'Run other workspace UI tests',
    );
    expect(otherStep?.if).toBe('matrix.shard == 1');
    if (!otherStep?.run) throw new Error('Other UI workspaces are not covered');
    const otherTasks = resolve(otherStep.run);
    for (const task of otherTasks) expect(task.cliArguments).toEqual([]);
    const allTasks = resolve('bunx turbo run test:ui');
    const coveredIds = [
      '@tale/platform#test:ui',
      ...otherTasks.map((task) => task.taskId),
    ];
    expect(new Set(coveredIds).size).toBe(coveredIds.length);
    expect(coveredIds.toSorted()).toEqual(
      allTasks.map((task) => task.taskId).sort(),
    );
  });

  test.skipIf(process.platform === 'win32')(
    'the stable UI gate refuses a failed, cancelled or unexpectedly skipped shard',
    async () => {
      const file = await workflow();
      const job = file.jobs['test-ui']!;
      expect(job.name).toBe('UI');
      expect(job.needs).toEqual(['candidate-source', 'test-ui-shards']);
      expect(job.permissions).toEqual({});
      expect(job['timeout-minutes']).toBeLessThanOrEqual(3);
      expect(job.steps?.some((step) => step.uses)).toBe(false);
      const step = job.steps?.find(
        (entry) => entry.name === 'Require every UI shard',
      );
      expect(step?.env?.SHARDS_RESULT).toBe(
        '${{ needs.test-ui-shards.result }}',
      );
      if (!step?.run) throw new Error('The stable UI gate has no assertion');
      for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
        const run = Bun.spawnSync(['bash', '-e', '-c', step.run], {
          cwd: repository,
          env: { ...process.env, SHARDS_RESULT: result },
        });
        expect(run.exitCode === 0, result).toBe(result === 'success');
      }
      expect(file.jobs['candidate-gate']?.needs).toContain('test-ui');
      expect(file.jobs['candidate-gate']?.needs).toContain('test-ui-shards');
    },
  );

  test('successful output is bounded while compiler diagnostics remain visible', async () => {
    const { jobs } = await workflow();
    for (const id of [
      'lint',
      'build',
      'test',
      'test-ui-shards',
      'test-browser',
    ]) {
      const commands = jobs[id]?.steps
        ?.map((step) => step.run ?? '')
        .filter((command) => command.includes('turbo run'));
      expect(commands?.length, id).toBeGreaterThan(0);
      for (const command of commands ?? [])
        expect(command, id).toContain('--output-logs=errors-only');
    }
    const compiler = jobs.typecheck?.steps
      ?.map((step) => step.run ?? '')
      .find((command) => command.includes('turbo run typecheck'));
    expect(compiler).toContain('--extendedDiagnostics');
    expect(compiler).not.toContain('--output-logs=errors-only');
  });

  test('each measured job retains its task execution and cache evidence after failure', async () => {
    const { jobs } = await workflow();
    const names = new Set<string>();
    for (const id of [
      'lint',
      'typecheck',
      'build',
      'test',
      'test-ui-shards',
      'test-browser',
    ]) {
      const steps = jobs[id]?.steps ?? [];
      const turboSteps = steps.filter((step) =>
        step.run?.includes('turbo run'),
      );
      expect(turboSteps.length, id).toBeGreaterThan(0);
      for (const step of turboSteps)
        expect(step.run, id).toContain('--summarize');
      const upload = steps.find(
        (step) => step.name === 'Upload Turbo execution summary',
      );
      expect(upload?.if, id).toBe('always()');
      expect(upload?.uses, id).toStartWith('actions/upload-artifact@');
      expect(upload?.with, id).toMatchObject({
        path: '.turbo/runs/*.json',
        'include-hidden-files': true,
        'if-no-files-found': 'ignore',
        'retention-days': 7,
      });
      expect(steps.indexOf(upload!), id).toBeGreaterThan(
        Math.max(...turboSteps.map((step) => steps.indexOf(step))),
      );
      const name = String(upload?.with?.name);
      expect(name, id).toStartWith(`turbo-${id}-`);
      expect(name, id).toContain('${{ github.run_id }}');
      expect(name, id).toContain('${{ github.run_attempt }}');
      if (jobs[id]?.strategy?.matrix?.shard)
        expect(name, id).toContain('${{ matrix.shard }}');
      expect(names.has(name), id).toBe(false);
      names.add(name);
    }
  });

  test('Bun download caches cover every workspace and never cross architectures', async () => {
    const action = parse(
      await readFile(
        join(repository, '.github/actions/setup-turbo/action.yml'),
        'utf8',
      ),
    ) as { runs: { steps: Step[] } };
    const cache = action.runs.steps.find((step) =>
      step.uses?.startsWith('actions/cache@'),
    )?.with;
    const key = String(cache?.key);
    const restore = String(cache?.['restore-keys']);
    for (const field of ['runner.os', 'runner.arch', 'inputs.bun-version']) {
      expect(key).toContain(`\${{ ${field} }}`);
      expect(restore).toContain(`\${{ ${field} }}`);
    }
    const manifest = z
      .object({ workspaces: z.array(z.string()) })
      .parse(
        JSON.parse(await readFile(join(repository, 'package.json'), 'utf8')),
      );
    for (const path of ['bun.lock', 'package.json', 'patches/**'])
      expect(key).toContain(`'${path}'`);
    for (const workspace of manifest.workspaces)
      expect(key).toContain(`'${workspace}/package.json'`);
    const install = action.runs.steps.find(
      (step) => step.name === 'Install JS dependencies',
    );
    expect(install?.run).toBe('bun install --frozen-lockfile');
    expect(install?.if).toBeUndefined();
  });

  test('the formatter cache hashes the manifest that pins Ruff without scanning installed dependencies', async () => {
    const setup = (await workflow()).jobs.format!.steps!.find((step) =>
      step.uses?.startsWith('astral-sh/setup-uv@'),
    );
    const manifestPath = z
      .string()
      .parse(setup?.with?.['cache-dependency-glob']);
    expect(manifestPath).toBe('package.json');
    const manifest = z
      .object({ scripts: z.record(z.string(), z.string()) })
      .parse(
        JSON.parse(await readFile(join(repository, manifestPath), 'utf8')),
      );
    expect(manifest.scripts['format:check']).toMatch(
      /uvx ruff@[\d.]+ format --check/,
    );
  });

  test('Browser shares the exact E2E browser cache and installs native dependencies even on a cache hit', async () => {
    const steps = (await workflow()).jobs['test-browser']!.steps!;
    const e2e = parse(
      await readFile(join(repository, '.github/workflows/e2e.yml'), 'utf8'),
    ) as { jobs: Record<string, { steps: Step[] }> };
    const resolver = steps.find((step) => step.id === 'playwright-version');
    expect(resolver?.['working-directory']).toBe('services/platform');
    expect(resolver?.run).toBeTruthy();
    // ci-e2e-optimization.test.ts exercises the shared resolver's failure path.
    expect(resolver?.run).toBe(
      e2e.jobs.e2e!.steps.find((step) => step.id === 'playwright-version')?.run,
    );
    const cache = steps.find((step) => step.uses?.startsWith('actions/cache@'));
    expect(cache?.with?.key).toBe(
      'playwright-${{ runner.os }}-${{ runner.arch }}-${{ steps.playwright-version.outputs.version }}',
    );
    expect(cache?.with?.['restore-keys']).toBeUndefined();
    const install = steps.find((step) =>
      step.run?.includes('bunx playwright install --with-deps chromium'),
    );
    expect(install).toBeDefined();
    expect(install?.if).toBeUndefined();
    expect(steps.indexOf(resolver!)).toBeLessThan(steps.indexOf(cache!));
    expect(steps.indexOf(cache!)).toBeLessThan(steps.indexOf(install!));
  });

  test('isolated unit and UI workers receive a job-local Node bytecode cache through Turbo strict mode', async () => {
    const file = await workflow();
    for (const job of ['test', 'test-ui-shards']) {
      const runs = file.jobs[job]!.steps!.filter((step) =>
        step.run?.includes('bunx turbo run test'),
      );
      expect(runs).toHaveLength(job === 'test' ? 1 : 2);
      for (const run of runs) {
        expect(run.env?.NODE_COMPILE_CACHE).toBe(
          '${{ runner.temp }}/node-compile-cache',
        );
        expect(run.run).not.toContain('--no-isolate');
        expect(run.run).not.toContain('--coverage');
      }
    }

    // Ask Turbo itself: an undeclared variable is silently dropped in strict
    // mode, while hashing this temporary path would needlessly miss the cache
    // on otherwise-identical work done in a different job directory.
    const hashes: string[][] = [];
    for (const cachePath of ['/tmp/tale-bytecode-a', '/tmp/tale-bytecode-b']) {
      const child = Bun.spawn(
        [
          process.execPath,
          'x',
          'turbo',
          'run',
          'test:ui',
          '--dry=json',
          '--cache=local:,remote:',
        ],
        {
          cwd: repository,
          env: {
            ...process.env,
            NODE_COMPILE_CACHE: cachePath,
            TURBO_TELEMETRY_DISABLED: '1',
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [status, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(status, stderr).toBe(0);
      const result = dryRunSchema
        .extend({
          envMode: z.string(),
          globalCacheInputs: z.object({
            environmentVariables: z.object({
              passthrough: z.array(z.string()),
            }),
          }),
        })
        .parse(JSON.parse(stdout));
      expect(result.envMode).toBe('strict');
      expect(
        result.globalCacheInputs.environmentVariables.passthrough.some(
          (value) => value.startsWith('NODE_COMPILE_CACHE='),
        ),
      ).toBe(true);
      expect(result.tasks.length).toBeGreaterThan(0);
      hashes.push(
        result.tasks.map((task) => `${task.taskId}=${task.hash}`).toSorted(),
      );
    }
    expect(hashes[0]).toEqual(hashes[1]);
  });
});
