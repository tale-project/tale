import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { parse } from 'yaml';
import { z } from 'zod';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
const workflowSchema = z.object({
  jobs: z.record(
    z.string(),
    z.object({
      name: z.string().optional(),
      services: z.record(z.string(), z.unknown()).optional(),
      steps: z
        .array(
          z.object({
            name: z.string().optional(),
            id: z.string().optional(),
            env: z.record(z.string(), z.string()).optional(),
            'working-directory': z.string().optional(),
            run: z.string().optional(),
            uses: z.string().optional(),
            if: z.string().optional(),
            with: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .default([]),
      strategy: z
        .object({
          'fail-fast': z.boolean().optional(),
          matrix: z.object({ shard: z.array(z.number()).optional() }),
        })
        .optional(),
    }),
  ),
});
const workflow = async () =>
  workflowSchema.parse(
    parse(
      await readFile(join(repository, '.github/workflows/checks.yml'), 'utf8'),
    ),
  );
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

function resolveTasks(command: string, taskName: string) {
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
      task.taskId.endsWith(`#${taskName}`) && task.command !== '<NONEXISTENT>',
  );
}

describe('Checks execution optimizations', () => {
  test('platform UI shards have distinct verdicts while every other UI workspace runs once', async () => {
    const job = (await workflow()).jobs['test-ui-shards'];
    expect(job.strategy?.['fail-fast']).toBe(false);
    const shards = job.strategy?.matrix?.shard;
    expect(shards).toEqual([1, 2, 3, 4]);
    expect(job.name).toBe('UI (platform ${{ matrix.shard }}/4)');
    const script = job.steps?.find((step) => step.name === 'Run UI tests')?.run;
    if (!script || !shards) throw new Error('The UI shard command is missing');

    const hashes = new Map<string, Set<string>>();
    const resolve = (command: string) => resolveTasks(command, 'test:ui');
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

  test('platform Unit shards have distinct verdicts and all other workspaces run exactly once', async () => {
    const { jobs } = await workflow();
    const platform = jobs['test-platform-shards'];
    const others = jobs['test-workspaces'];
    const shards = platform.strategy?.matrix.shard;
    expect(shards).toEqual([1, 2]);
    expect(platform.strategy?.['fail-fast']).toBe(false);
    expect(platform.name).toBe('Unit (platform ${{ matrix.shard }}/2)');
    expect(others.strategy).toBeUndefined();
    const script = platform.steps.find(
      (step) => step.name === 'Run platform Unit tests',
    )?.run;
    if (!script || !shards)
      throw new Error('The Unit shard command is missing');
    const hashes = new Set<string>();
    for (const shard of shards) {
      const tasks = resolveTasks(
        script.replaceAll('${{ matrix.shard }}', String(shard)),
        'test',
      );
      expect(tasks.map((task) => task.taskId)).toEqual(['@tale/platform#test']);
      expect(tasks[0]!.command).toBe(
        'bunx vitest --run --project server --project pii',
      );
      expect(tasks[0]!.cliArguments).toEqual([`--shard=${shard}/2`]);
      hashes.add(tasks[0]!.hash);
    }
    expect(hashes.size).toBe(shards.length);
    const otherStep = others.steps.find(
      (step) => step.name === 'Run other workspace Unit tests',
    );
    if (!otherStep?.run)
      throw new Error('Other Unit workspaces are not covered');
    expect(otherStep.if).toBeUndefined();
    expect(otherStep.run).toContain('--concurrency=2');
    const otherTasks = resolveTasks(otherStep.run, 'test');
    for (const task of otherTasks) expect(task.cliArguments).toEqual([]);
    const covered = [
      '@tale/platform#test',
      ...otherTasks.map((task) => task.taskId),
    ];
    expect(new Set(covered).size).toBe(covered.length);
    expect(covered.toSorted()).toEqual(
      resolveTasks('bunx turbo run test', 'test')
        .map((task) => task.taskId)
        .sort(),
    );
  });

  test('platform Unit retains the installed Vitest server and PII project coverage and isolation', async () => {
    // Inspect the actual resolved project policy without discovering platform
    // source filenames: those belong to the platform task's inputs, not the
    // CLI task's. The complete real shard inventory is recorded with CI proof.
    const child = Bun.spawnSync(
      [
        'node',
        '--input-type=module',
        '-e',
        `
        import { createVitest } from 'vitest/node';
        const ctx = await createVitest('test', {
          root: process.cwd(), config: 'vitest.config.ts',
          project: ['server', 'pii'], watch: false,
        });
        try {
          console.log(JSON.stringify(ctx.projects.map(project => ({
            name: project.name,
            isolate: project.config.isolate,
            include: project.config.include,
            exclude: project.config.exclude,
          }))));
        } finally { await ctx.close(); }
      `,
      ],
      {
        cwd: join(repository, 'services/platform'),
        // Keep this server/PII policy probe independent of a caller running
        // inside Vitest; the Storybook addon uses this flag to load stories.
        env: { ...process.env, VITEST: 'false' },
      },
    );
    expect(child.exitCode, child.stderr.toString()).toBe(0);
    const projects = z
      .array(
        z.object({
          name: z.string(),
          isolate: z.boolean(),
          include: z.array(z.string()),
          exclude: z.array(z.string()),
        }),
      )
      .parse(JSON.parse(child.stdout.toString()));
    expect(projects.map((project) => project.name)).toEqual(['server', 'pii']);
    expect(projects[0]).toMatchObject({
      isolate: true,
      include: ['**/*.test.{ts,tsx}'],
    });
    expect(projects[0]!.exclude).toEqual(
      expect.arrayContaining(['tests/pii/**', 'lib/pii/**/*.test.{ts,tsx}']),
    );
    expect(projects[1]).toMatchObject({
      isolate: false,
      include: ['tests/pii/**/*.test.ts', 'lib/pii/**/*.test.ts'],
    });
  });

  test('only platform Unit workers provision the live YouTube service and each lane has its own cache scope', async () => {
    const { jobs } = await workflow();
    const platform = jobs['test-platform-shards'];
    expect(platform.services).toEqual({
      bgutil: {
        image: 'brainicism/bgutil-ytdlp-pot-provider:1.3.1',
        ports: ['4416:4416'],
      },
    });
    expect(
      platform.steps.find((step) => step.name === 'Run platform Unit tests')
        ?.env,
    ).toMatchObject({
      YOUTUBE_LIVE_TEST: '1',
      VIDEO_INGEST_POT_PROVIDER_URL: 'http://127.0.0.1:4416',
    });
    for (const id of ['test', 'test-workspaces']) {
      expect(jobs[id].services, id).toBeUndefined();
      for (const step of jobs[id].steps) {
        expect(step.env?.YOUTUBE_LIVE_TEST, id).toBeUndefined();
        expect(step.env?.VIDEO_INGEST_POT_PROVIDER_URL, id).toBeUndefined();
      }
    }
    for (const [id, scope] of [
      ['test-platform-shards', 'test-platform-${{ matrix.shard }}'],
      ['test-workspaces', 'test-workspaces'],
    ]) {
      expect(
        jobs[id].steps.find((step) => step.name === 'Setup toolchain')?.with?.[
          'cache-scope'
        ],
      ).toBe(scope);
    }
  });

  test('successful output is bounded while compiler diagnostics remain visible', async () => {
    const { jobs } = await workflow();
    for (const id of [
      'lint',
      'build',
      'test-platform-shards',
      'test-workspaces',
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
      'test-platform-shards',
      'test-workspaces',
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
        'include-hidden-files': true,
        'if-no-files-found': 'ignore',
        'retention-days': 7,
      });
      const paths = z.string().parse(upload?.with?.path).trim().split('\n');
      expect(paths, id).toContain('.turbo/runs/*.json');
      const testLogs: Record<string, string> = {
        'test-platform-shards': 'test',
        'test-workspaces': 'test',
        'test-ui-shards': 'test$colon$ui',
        'test-browser': 'test$colon$browser',
      };
      const task = testLogs[id];
      if (task) {
        for (const workspace of [
          'packages/*',
          'services/*',
          'services/sandbox-runtime/daemon',
          'tools/*',
          'configs/platform/custom/skills/*',
        ])
          expect(paths, id).toContain(`${workspace}/.turbo/turbo-${task}.log`);
      } else {
        expect(paths).toEqual(['.turbo/runs/*.json']);
      }
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

  test('formatting skips task archives while every source checkout drops stored credentials', async () => {
    const { jobs } = await workflow();
    const setup = jobs.format!.steps.find(
      (step) => step.uses === './.github/actions/setup-turbo',
    );
    expect(setup?.with?.['turbo-cache']).toBe('false');
    expect(
      jobs.format!.steps.some((step) => step.run === 'bun run format:check'),
    ).toBe(true);
    for (const [id, job] of Object.entries(jobs)) {
      const checkout = job.steps.find((step) =>
        step.uses?.startsWith('actions/checkout@'),
      );
      if (checkout)
        expect(checkout.with?.['persist-credentials'], id).toBe(false);
    }
  });

  test('browser provisioning defaults to cold setup while candidates bypass cache admission', async () => {
    const steps = (await workflow()).jobs['test-browser']!.steps;
    const admission = steps.find((step) => step.id === 'browser-cache');
    expect(admission?.if).toBe(
      "github.event_name != 'repository_dispatch' && hashFiles('scripts/ci-task-cache.ts') != ''",
    );
    expect(admission?.run).toBe(
      'bun scripts/ci-task-cache.ts test:browser >> "$GITHUB_OUTPUT"',
    );
    expect(admission?.env).toEqual({
      TURBO_CACHE_MAX_SIZE: '0',
      TURBO_CACHE_MAX_AGE: '0',
    });
    for (const name of [
      'Resolve Playwright version',
      'Cache Playwright browsers',
      'Install Playwright Chromium',
    ]) {
      const step = steps.find((entry) => entry.name === name);
      expect(step?.if, name).toBe(
        "steps.browser-cache.outputs.provision != 'false'",
      );
      expect(steps.indexOf(step!), name).toBeGreaterThan(
        steps.indexOf(admission!),
      );
    }
    const verdict = steps.find(
      (step) => step.name === 'Run browser-mode component tests',
    );
    expect(verdict?.if).toBeUndefined();
    expect(verdict?.run).toBe(
      'bunx turbo run test:browser --output-logs=errors-only --summarize',
    );
    expect(verdict?.env).toEqual(admission?.env);
    const restore = steps.find((step) => step.id === 'playwright-cache');
    const install = steps.find(
      (step) => step.name === 'Install Playwright Chromium',
    );
    const save = steps.find((step) => step.name === 'Save Playwright browsers');
    expect(restore?.uses).toMatch(/^actions\/cache\/restore@[a-f0-9]{40}$/);
    expect(restore?.env?.SEGMENT_DOWNLOAD_TIMEOUT_MINS).toBe('2');
    expect(save?.uses).toBe(restore?.uses?.replace('/restore@', '/save@'));
    expect(save?.if).toBe(
      "steps.browser-cache.outputs.provision != 'false' && steps.playwright-cache.outputs.cache-hit != 'true'",
    );
    expect(save?.with).toEqual({
      path: '~/.cache/ms-playwright',
      key: '${{ steps.playwright-cache.outputs.cache-primary-key }}',
    });
    expect(steps.indexOf(save!)).toBeGreaterThan(steps.indexOf(install!));
    expect(steps.indexOf(save!)).toBeLessThan(steps.indexOf(verdict!));
  });

  test('historical sources without the browser helper retain provisioning for every admitted event', async () => {
    const steps = (await workflow()).jobs['test-browser']!.steps;
    const admission = steps.find((step) => step.id === 'browser-cache');
    const condition = z.string().parse(admission?.if);
    const fixture = await mkdtemp(join(tmpdir(), 'tale-browser-admission-'));
    const helperPath = 'scripts/ci-task-cache.ts';
    try {
      for (const present of [false, true]) {
        if (present) {
          await mkdir(join(fixture, 'scripts'));
          await writeFile(join(fixture, helperPath), 'synthetic helper source');
        }
        const file = Bun.file(join(fixture, helperPath));
        const hash = (await file.exists())
          ? createHash('sha256')
              .update(await file.bytes())
              .digest('hex')
          : '';
        for (const event of [
          'push',
          'pull_request',
          'merge_group',
          'workflow_dispatch',
          'repository_dispatch',
        ]) {
          const admitted = runInNewContext(condition, {
            github: { event_name: event },
            hashFiles: (path: string) => {
              expect(path).toBe(helperPath);
              return hash;
            },
          });
          expect(admitted, `${event}, helper=${present}`).toBe(
            present && event !== 'repository_dispatch',
          );
          for (const output of ['', 'true', 'false', 'unexpected']) {
            const provision = admitted ? output : '';
            for (const name of [
              'Resolve Playwright version',
              'Cache Playwright browsers',
              'Install Playwright Chromium',
            ]) {
              const source = z
                .string()
                .parse(steps.find((step) => step.name === name)?.if)
                .replaceAll('steps.browser-cache', "steps['browser-cache']");
              expect(
                runInNewContext(source, {
                  steps: { 'browser-cache': { outputs: { provision } } },
                }),
                `${event}, helper=${present}, output=${output}, ${name}`,
              ).toBe(provision !== 'false');
            }
          }
        }
      }
      expect(
        steps.find((step) => step.name === 'Run browser-mode component tests')
          ?.if,
      ).toBeUndefined();
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test('compiler families, Bun install settings and patches owe the real backend proof', async () => {
    const steps = (await workflow()).jobs['integration-scope']!.steps;
    const filter = steps.find((step) => step.id === 'filter');
    const patterns = z
      .object({ integration: z.array(z.string()) })
      .parse(parse(z.string().parse(filter?.with?.filters))).integration;
    const compilerFiles = (await readdir(repository)).filter(
      (file) => file.startsWith('tsconfig') && file.endsWith('.json'),
    );
    expect(compilerFiles.length).toBeGreaterThan(0);
    for (const path of [
      ...compilerFiles,
      'bunfig.toml',
      'patches/postgres@3.4.7.patch',
    ])
      expect(
        patterns.some((pattern) => new Bun.Glob(pattern).match(path)),
        path,
      ).toBe(true);
    const readiness = (await workflow()).jobs[
      'backend-integration'
    ]!.steps.find((step) => step.name === 'Start tale-db and the object store');
    const requests =
      readiness?.run?.split('\n').filter((line) => line.includes('curl ')) ??
      [];
    expect(requests).toHaveLength(2);
    for (const request of requests)
      expect(request).toContain('curl --connect-timeout 2 --max-time 5');
  });

  test('isolated unit and UI workers receive a job-local Node bytecode cache through Turbo strict mode', async () => {
    const file = await workflow();
    for (const job of [
      'test-platform-shards',
      'test-workspaces',
      'test-ui-shards',
    ]) {
      const runs = file.jobs[job]!.steps!.filter((step) =>
        step.run?.includes('bunx turbo run test'),
      );
      expect(runs).toHaveLength(job === 'test-ui-shards' ? 2 : 1);
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
        // Only executable tasks create Node workers; placeholder hashes
        // belong to unrelated workspaces.
        result.tasks
          .filter((task) => task.command !== '<NONEXISTENT>')
          .map((task) => `${task.taskId}=${task.hash}`)
          .toSorted(),
      );
    }
    expect(hashes[0]).toEqual(hashes[1]);
  });
});
