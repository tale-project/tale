import {
  afterEach,
  describe,
  expect,
  mock,
  setDefaultTimeout,
  test,
} from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { ExitCode } from '../../utils/fail';
import type { ExecResult } from '../docker/exec';
import { applyRuntime } from './runtime-apply';
import { runtimeCommand } from './runtime-command';
import type { RuntimeDependencies } from './runtime-model';
import { prepareRuntime } from './runtime-prepare';
import {
  installLegacy,
  RuntimeDockerFixture,
  runtimeFixture,
  type RuntimeFixture,
} from './runtime-test-helper';

// Tests here build the git runtime fixture (four git spawns per build);
// Windows CI runners stall on git for seconds at a time, and the 5 s
// default killed a passing test mid-commit.
setDefaultTimeout(30_000);

const privateValue = 'synthetic-private-value';
const failedResult = {
  success: false,
  exitCode: 1,
  stdout: privateValue,
  stderr: privateValue,
};

describe('managed Docker operation diagnostics', () => {
  for (const operation of ['compose-validation', 'compose-startup'] as const) {
    const label =
      operation === 'compose-validation'
        ? 'managed Compose validation'
        : 'managed Compose startup';
    test.each(['exit', 'throw'] as const)(
      `${operation} identifies %s failures without exposing private inputs`,
      async (failure) => {
        const calls: Parameters<NonNullable<RuntimeDependencies['exec']>>[] =
          [];
        const dependencies: RuntimeDependencies = {
          exec: async (...args) => {
            calls.push(args);
            if (failure === 'throw') throw new Error(privateValue);
            return failedResult;
          },
        };
        const summary =
          failure === 'throw'
            ? `Docker could not complete ${label}.`
            : `Docker refused ${label}.`;
        expect(
          await runtimeCommand(
            ['compose', '--env-file', privateValue],
            dependencies,
            {
              operation,
              cwd: privateValue,
              timeout: 600,
            },
          ).catch((error: unknown) => error),
        ).toMatchObject({
          message: summary,
          info: { summary, code: ExitCode.ExternalDep, cause: undefined },
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject([
          'docker',
          ['compose', '--env-file', privateValue],
          { cwd: privateValue, timeout: 600, silent: true },
        ]);
        expect(calls[0][2]?.env).toBeDefined();
        expect(calls[0][2]?.env).not.toHaveProperty('COMPOSE_PROJECT_NAME');
      },
    );
  }

  test.each(['exit', 'throw'] as const)(
    'unlabelled %s failures retain the existing safe diagnostic',
    async (failure) => {
      const summary =
        failure === 'throw'
          ? 'Docker could not complete the managed runtime operation.'
          : 'Docker refused the managed runtime operation.';
      expect(
        await runtimeCommand([privateValue], {
          exec: async () => {
            if (failure === 'throw') throw new Error(privateValue);
            return failedResult;
          },
        }).catch((error: unknown) => error),
      ).toMatchObject({
        message: summary,
        info: { summary, code: ExitCode.ExternalDep, cause: undefined },
      });
    },
  );

  test.each(['exit', 'throw'] as const)(
    'a startup %s failure names what Docker state shows, never what the command printed',
    async (failure) => {
      const diagnose = mock(async () => 'proxy: unhealthy');
      const summary =
        failure === 'throw'
          ? 'Docker could not complete managed Compose startup (proxy: unhealthy).'
          : 'Docker refused managed Compose startup (proxy: unhealthy).';
      expect(
        await runtimeCommand(
          ['compose', 'up'],
          {
            exec: async () => {
              if (failure === 'throw') throw new Error(privateValue);
              return failedResult;
            },
          },
          { operation: 'compose-startup', diagnose },
        ).catch((error: unknown) => error),
      ).toMatchObject({
        message: summary,
        info: { summary, code: ExitCode.ExternalDep, cause: undefined },
      });
      expect(diagnose).toHaveBeenCalledTimes(1);
    },
  );

  const undiagnosed: [string, () => Promise<string | null>][] = [
    ['has nothing to add', async () => null],
    [
      'cannot read Docker',
      async () => {
        throw new Error(privateValue);
      },
    ],
  ];
  test.each(undiagnosed)(
    'keeps the fixed summary when the diagnosis %s',
    async (_label, diagnose) => {
      const error = await runtimeCommand(
        ['compose', 'up'],
        { exec: async () => failedResult },
        { operation: 'compose-startup', diagnose },
      ).catch((failure: unknown) => failure);
      expect(error).toMatchObject({
        message: 'Docker refused managed Compose startup.',
      });
      expect(JSON.stringify(error)).not.toContain(privateValue);
    },
  );

  test('never diagnoses a success or an allowed failure', async () => {
    const diagnose = mock(async () => 'proxy: unhealthy');
    await runtimeCommand(
      ['compose'],
      { exec: async () => ({ ...failedResult, success: true, exitCode: 0 }) },
      { operation: 'compose-startup', diagnose },
    );
    await runtimeCommand(
      ['compose'],
      { exec: async () => failedResult },
      { operation: 'compose-startup', allowFailure: true, diagnose },
    );
    expect(diagnose).not.toHaveBeenCalled();
  });

  test('an unknown operation never becomes part of the diagnostic', async () => {
    const options: Parameters<typeof runtimeCommand>[2] = {};
    Object.assign(options, { operation: privateValue });
    expect(
      await runtimeCommand(
        ['compose'],
        { exec: async () => failedResult },
        options,
      ).catch((error: unknown) => error),
    ).toMatchObject({
      message: 'Docker refused the managed runtime operation.',
    });
  });

  test.each([
    ['successful', true],
    ['failed', false],
  ] as const)(
    'allowFailure preserves the original %s result',
    async (_label, success) => {
      const result = { ...failedResult, success, exitCode: success ? 0 : 1 };
      expect(
        await runtimeCommand(
          ['compose'],
          { exec: async () => result },
          { operation: 'compose-startup', allowFailure: true },
        ),
      ).toBe(result);
    },
  );
});

const fixtures: RuntimeFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture.directory, { recursive: true, force: true });
});

// Runtime custody uses POSIX modes. The command-only cases above are portable.
describe.skipIf(process.platform === 'win32')(
  'managed runtime Compose failure context',
  () => {
    test.each([
      ['config', 'Docker refused managed Compose validation.'],
      ['up', 'Docker refused managed Compose startup.'],
    ])(
      'labels the real %s call and keeps its receipt pending',
      async (step, summary) => {
        const fixture = runtimeFixture();
        fixtures.push(fixture);
        const docker = new RuntimeDockerFixture(fixture);
        await prepareRuntime(
          {
            repoRoot: fixture.repoRoot,
            revision: fixture.revision,
            output: fixture.options.bundleDirectory,
            platform: 'linux/amd64',
          },
          docker.dependencies(),
        );
        const composeCalls: string[][] = [];
        expect(
          await applyRuntime(fixture.options, {
            ...docker.dependencies(),
            exec: async (command, args, options) => {
              if (args[0] === 'compose') {
                composeCalls.push(args);
                if (args.includes(step)) return failedResult;
              }
              return docker.execute(command, args, options);
            },
          }).catch((error: unknown) => error),
        ).toMatchObject({
          message: summary,
          info: { summary, code: ExitCode.ExternalDep, cause: undefined },
        });
        expect(composeCalls.at(-1)).toContain(step);
        if (step === 'config')
          expect(composeCalls.some((args) => args.includes('up'))).toBe(false);
        expect(
          JSON.parse(
            readFileSync(
              join(fixture.options.stateDirectory, '.tale/runtime.json'),
              'utf8',
            ),
          ).phase,
        ).toBe('pending');
      },
      30_000,
    );

    // Compose names the unhealthy dependency only in output that can also
    // carry the environment; the summary reads Docker's state instead.
    test('names the unhealthy service a refused startup stopped on, from Docker state alone', async () => {
      const fixture = runtimeFixture();
      fixtures.push(fixture);
      const docker = new RuntimeDockerFixture(fixture);
      await prepareRuntime(
        {
          repoRoot: fixture.repoRoot,
          revision: fixture.revision,
          output: fixture.options.bundleDirectory,
          platform: 'linux/amd64',
        },
        docker.dependencies(),
      );
      installLegacy(fixture, docker);
      docker.staleHealth.set('proxy', { status: 'unhealthy', reads: Infinity });
      const refusals: ExecResult[] = [];
      const summary =
        'Docker refused managed Compose startup (proxy: unhealthy).';

      expect(
        await applyRuntime(fixture.options, {
          ...docker.dependencies(),
          exec: async (command, args, options) => {
            const result = await docker.execute(command, args, options);
            if (args[0] === 'compose' && args.includes('up'))
              refusals.push(result);
            return result;
          },
        }).catch((error: unknown) => error),
      ).toMatchObject({
        message: summary,
        info: { summary, code: ExitCode.ExternalDep, cause: undefined },
      });
      expect(refusals).toHaveLength(1);
      expect(refusals[0].stderr).toContain('is unhealthy');
      expect(
        JSON.parse(
          readFileSync(
            join(fixture.options.stateDirectory, '.tale/runtime.json'),
            'utf8',
          ),
        ).phase,
      ).toBe('pending');
    }, 30_000);
  },
);
