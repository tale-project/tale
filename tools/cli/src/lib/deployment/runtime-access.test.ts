import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CliError } from '../../utils/fail';
import type { exec, ExecResult } from '../docker/exec';
import {
  budgetedDockerRun,
  budgetedExec,
  COPY_OUT_LIMIT_SENTENCE,
  dockerExecArgs,
  dockerRuntimeAccess,
  managedCommandAccess,
  type RuntimeBudget,
} from './runtime-access';

type Call = {
  command: string;
  args: string[];
  options: Parameters<typeof exec>[2];
};

const ok = (stdout = ''): ExecResult => ({
  success: true,
  stdout,
  stderr: '',
  exitCode: 0,
});
const refusedResult: ExecResult = {
  success: false,
  stdout: '',
  stderr: 'refused',
  exitCode: 1,
};

/** A Docker access over a recording executor that answers `answer`. */
function recorded(answer: (args: string[]) => ExecResult = () => ok()) {
  const calls: Call[] = [];
  const budget: RuntimeBudget<{ cleanup?: boolean }> = {
    bounds: (tag) => ({
      timeout: tag?.cleanup ? 2 : 15,
      maxOutputBytes: 1_048_576,
    }),
    failed: () => new Error('failed'),
    refused: () => new Error('refused'),
  };
  const runtime = dockerRuntimeAccess(
    budgetedDockerRun(budget, {
      exec: async (command, args, options) => {
        calls.push({ command, args, options });
        return answer(args);
      },
      environment: () => ({ PATH: '/usr/bin' }),
    }),
  );
  return { runtime, calls, argv: () => calls.map((call) => call.args) };
}

const ID = 'a'.repeat(64);
const IMAGE = `sha256:${'b'.repeat(64)}`;

describe('Docker runtime access argv', () => {
  test('exec spells -i, -w, --env and --user in the order every caller used', async () => {
    const { runtime, argv, calls } = recorded();
    await runtime.exec('backend', ['stat', '-c', '%u:%g', '/app/data']);
    await runtime.exec('db', ['sh', '-s'], { stdin: 'SELECT 1;' });
    await runtime.exec('backend', ['bun', 'cli.mjs'], {
      stdin: '{}',
      workdir: '/',
      user: '1001:1001',
    });
    await runtime.exec('backend', ['tale'], {
      stdin: '{}',
      environment: { HTTP_PROXY: '', NO_PROXY: '*' },
      user: '1001:1001',
    });
    await runtime.exec('platform', ['bun', '--eval', 'x'], {
      environment: { no_proxy: '*' },
    });
    expect(argv()).toEqual([
      ['exec', 'backend', 'stat', '-c', '%u:%g', '/app/data'],
      ['exec', '-i', 'db', 'sh', '-s'],
      [
        'exec',
        '-i',
        '-w',
        '/',
        '--user',
        '1001:1001',
        'backend',
        'bun',
        'cli.mjs',
      ],
      [
        'exec',
        '-i',
        '--env',
        'HTTP_PROXY=',
        '--env',
        'NO_PROXY=*',
        '--user',
        '1001:1001',
        'backend',
        'tale',
      ],
      ['exec', '--env', 'no_proxy=*', 'platform', 'bun', '--eval', 'x'],
    ]);
    expect(calls.map((call) => call.command)).toEqual(Array(5).fill('docker'));
    expect(calls[1].options?.stdin).toBe('SELECT 1;');
    expect(calls[0].options).not.toHaveProperty('stdin');
  });

  test('copies, stops and restarts keep their docker argv', async () => {
    const { runtime, argv } = recorded();
    await runtime.copyIn('backend', { directory: '/host/bundle' }, '/tmp/t');
    await runtime.copyIn('backend', { file: '/host/tale' }, '/tmp/t/tale');
    const receive = mkdtempSync(join(tmpdir(), 'tale-access-receive-'));
    try {
      await runtime.copyOut('backend', '/tmp/t/export-output', receive, {
        maxBytes: 1024,
      });
    } finally {
      rmSync(receive, { recursive: true, force: true });
    }
    await runtime.stop([ID, 'c'.repeat(64)]);
    await runtime.restart(ID, 30);
    expect(argv()).toEqual([
      ['cp', '/host/bundle/.', 'backend:/tmp/t/'],
      ['cp', '/host/tale', 'backend:/tmp/t/tale'],
      ['cp', 'backend:/tmp/t/export-output/.', `${receive}/`],
      ['stop', '--time=-1', ID, 'c'.repeat(64)],
      ['restart', '--time', '30', ID],
    ]);
  });

  test('the census reads list ids, services and volumes', async () => {
    const { runtime, argv } = recorded((args) =>
      args[0] === 'volume'
        ? ok('{"Name":"tale_db-data"}\n{"Name":"other"}\n')
        : args.at(-1) === '{{.ID}}'
          ? ok(`${ID}\n\n`)
          : ok(`${ID}\tbackend-api\nmalformed\n`),
    );
    expect(await runtime.list({ stack: 'tale' })).toEqual([ID]);
    expect(await runtime.list({ stack: 'tale', service: 'db' })).toEqual([ID]);
    expect(await runtime.listServices('tale-blue')).toEqual([
      { id: ID, service: 'backend-api' },
      { id: 'malformed', service: null },
    ]);
    expect(await runtime.listVolumes()).toEqual(['tale_db-data', 'other']);
    expect(argv()).toEqual([
      [
        'ps',
        '-a',
        '--no-trunc',
        '--filter',
        'label=com.docker.compose.project=tale',
        '--format',
        '{{.ID}}',
      ],
      [
        'ps',
        '-a',
        '--no-trunc',
        '--filter',
        'label=com.docker.compose.project=tale',
        '--filter',
        'label=com.docker.compose.service=db',
        '--format',
        '{{.ID}}',
      ],
      [
        'ps',
        '-a',
        '--no-trunc',
        '--filter',
        'label=com.docker.compose.project=tale-blue',
        '--format',
        '{{.ID}}\t{{.Label "com.docker.compose.service"}}',
      ],
      ['volume', 'ls', '--format', '{{json .}}'],
    ]);
  });
});

describe('Docker runtime access readback', () => {
  const secret = 'synthetic-secret-sentinel';
  const container = {
    Id: ID,
    Image: IMAGE,
    RestartCount: 0,
    State: {
      Running: true,
      StartedAt: '2026-11-12T10:00:00.123456789Z',
      Pid: 42,
      Status: 'running',
      Dead: false,
    },
    HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
    Config: {
      Image: 'ghcr.io/tale-project/tale/tale-platform@sha256:x',
      Labels: {
        'com.docker.compose.project': 'tale',
        'com.docker.compose.service': 'backend-api',
        'com.docker.compose.oneoff': 'False',
      },
      Env: [
        `BETTER_AUTH_SECRET=${secret}`,
        'DATABASE_URL=postgres://tale:pw@db:5432/tale_app',
      ],
    },
    NetworkSettings: {
      Networks: {
        tale_default: { NetworkID: 'n'.repeat(64), IPAddress: '10.0.0.2' },
      },
    },
    Mounts: [{ Type: 'volume', Source: '/var/lib/x', Destination: '/data' }],
  };

  test('container inspect normalizes and keeps no environment entry, only whether the database is bundled', async () => {
    const { runtime, argv } = recorded(() => ok(JSON.stringify([container])));
    const [instance] = await runtime.inspect([ID]);
    expect(argv()).toEqual([['container', 'inspect', ID]]);
    expect(instance).toEqual({
      id: ID,
      image: IMAGE,
      imageReference: container.Config.Image,
      restartCount: 0,
      running: true,
      startedAt: container.State.StartedAt,
      pid: 42,
      status: 'running',
      dead: false,
      restartPolicy: 'unless-stopped',
      labels: container.Config.Labels,
      environmentSize: 2,
      bundledDatabase: true,
      networks: { tale_default: { id: 'n'.repeat(64), address: '10.0.0.2' } },
      mounts: [{ type: 'volume', source: '/var/lib/x', target: '/data' }],
    });
    expect(JSON.stringify(instance)).not.toContain(secret);
    expect(JSON.stringify(instance)).not.toContain('postgres://');
  });

  test('bundledDatabase is decided in the access: one bundled DATABASE_URL, nothing else', async () => {
    const judged = async (env: string[] | undefined) => {
      const { runtime } = recorded(() =>
        ok(
          JSON.stringify([
            { ...container, Config: { ...container.Config, Env: env } },
          ]),
        ),
      );
      return (await runtime.inspect([ID]))[0].bundledDatabase;
    };
    expect(
      await judged(['DATABASE_URL=postgresql://tale:pw@db:5432/tale_app']),
    ).toBe(true);
    expect(
      await judged(['DATABASE_URL=postgresql://tale:pw@other:5432/tale_app']),
    ).toBe(false);
    expect(
      await judged(['DATABASE_URL=postgresql://tale:pw@db:5432/other']),
    ).toBe(false);
    expect(await judged(['DATABASE_URL=postgresql://db:5432/tale_app'])).toBe(
      false,
    );
    expect(
      await judged([
        'DATABASE_URL=postgresql://tale:pw@db:5432/tale_app',
        'DATABASE_URL=postgresql://tale:pw@db:5432/tale_app',
      ]),
    ).toBe(false);
    expect(await judged(['OTHER=1'])).toBe(false);
    expect(await judged(undefined)).toBeUndefined();
  });

  test('copyOut refuses a copy larger than its cap with the fixed sentence', async () => {
    const receive = mkdtempSync(join(tmpdir(), 'tale-access-cap-'));
    try {
      const { runtime } = recorded(() => {
        writeFileSync(join(receive, 'big'), 'x'.repeat(2048));
        return ok('');
      });
      await expect(
        runtime.copyOut('backend', '/tmp/t/out', receive, { maxBytes: 1024 }),
      ).rejects.toThrow(COPY_OUT_LIMIT_SENTENCE);
      await expect(
        runtime.copyOut('backend', '/tmp/t/out', receive, { maxBytes: 4096 }),
      ).resolves.toMatchObject({ success: true });
    } finally {
      rmSync(receive, { recursive: true, force: true });
    }
  });

  test('an unreported field is absent, never an undefined key', async () => {
    const { runtime } = recorded(() => ok(JSON.stringify([{ Id: ID }])));
    const [instance] = await runtime.inspect([ID]);
    expect(Object.keys(instance)).toEqual(['id']);
  });

  test('the metadata-only read uses the --format projection', async () => {
    const { runtime, argv } = recorded(() =>
      ok(
        `${JSON.stringify({
          id: ID,
          image: IMAGE,
          project: 'tale',
          service: null,
          running: false,
          startedAt: '0001-01-01T00:00:00Z',
          restartCount: 3,
          mounts: [],
        })}\n`,
      ),
    );
    const [instance] = await runtime.inspect([ID], { metadataOnly: true });
    expect(argv()[0].slice(0, 2)).toEqual(['inspect', '--format']);
    expect(argv()[0].at(-1)).toBe(ID);
    expect(argv()[0][2]).not.toContain('Env');
    expect(instance).toEqual({
      id: ID,
      image: IMAGE,
      labels: { 'com.docker.compose.project': 'tale' },
      running: false,
      startedAt: '0001-01-01T00:00:00Z',
      restartCount: 3,
      mounts: [],
    });
  });

  test('image inspect normalizes labels, digests and platform', async () => {
    const { runtime, argv } = recorded((args) =>
      args[2] === '--format'
        ? ok(
            `${JSON.stringify({
              id: IMAGE,
              revision: 'r',
              version: null,
              architecture: 'arm64',
              os: 'linux',
            })}\n`,
          )
        : ok(
            JSON.stringify([
              {
                Id: IMAGE,
                RepoDigests: ['repo@sha256:1'],
                Os: 'linux',
                Architecture: 'amd64',
                Config: { Labels: null },
              },
              { Id: IMAGE },
            ]),
          ),
    );
    expect(await runtime.inspectImage(['repo:1', 'repo:2'])).toEqual([
      {
        id: IMAGE,
        repoDigests: ['repo@sha256:1'],
        os: 'linux',
        architecture: 'amd64',
        labels: null,
      },
      { id: IMAGE },
    ]);
    expect(await runtime.inspectImage([IMAGE], { metadataOnly: true })).toEqual(
      [
        {
          id: IMAGE,
          os: 'linux',
          architecture: 'arm64',
          labels: { 'org.opencontainers.image.revision': 'r' },
        },
      ],
    );
    expect(argv()[0]).toEqual(['image', 'inspect', 'repo:1', 'repo:2']);
    expect(argv()[1].slice(0, 3)).toEqual(['image', 'inspect', '--format']);
  });
});

describe('runtime budget', () => {
  test('bounds before, settles after, refuses an unsuccessful call unless it allows failure', async () => {
    const events: string[] = [];
    const calls: Call[] = [];
    const budget: RuntimeBudget<{ cleanup?: boolean }> = {
      bounds: (tag) => {
        events.push(`bounds:${tag?.cleanup ?? false}`);
        return tag?.cleanup
          ? { timeout: 2 }
          : { timeout: 10, maxOutputBytes: 9 };
      },
      failed: () => new Error('could not run'),
      settled: (result) => {
        events.push(`settled:${result.success}`);
      },
      refused: (result) => new Error(`refused: ${result.exitCode}`),
    };
    const runtime = dockerRuntimeAccess(
      budgetedDockerRun(budget, {
        exec: async (command, args, options) => {
          calls.push({ command, args, options });
          return args.includes('fail') ? refusedResult : ok('fine');
        },
        environment: () => ({ DOCKER_HOST: 'unix:///var/run/docker.sock' }),
      }),
    );
    expect((await runtime.exec('c', ['true'])).stdout).toBe('fine');
    await expect(runtime.exec('c', ['fail'])).rejects.toThrow('refused: 1');
    expect(
      (
        await runtime.exec('c', ['fail'], {
          allowFailure: true,
          tag: { cleanup: true },
        })
      ).success,
    ).toBe(false);
    expect(events).toEqual([
      'bounds:false',
      'settled:true',
      'bounds:false',
      'settled:false',
      'bounds:true',
      'settled:false',
    ]);
    expect(calls[0].options).toEqual({
      silent: true,
      timeout: 10,
      maxOutputBytes: 9,
      env: { DOCKER_HOST: 'unix:///var/run/docker.sock' },
    });
    expect(calls[2].options).toEqual({
      silent: true,
      timeout: 2,
      env: { DOCKER_HOST: 'unix:///var/run/docker.sock' },
    });
  });

  test('a call that cannot run fails with the budget sentence, never its cause', async () => {
    const runtime = dockerRuntimeAccess(
      budgetedDockerRun(
        {
          bounds: () => ({ timeout: 1 }),
          failed: () => new Error('bounded call failed'),
          refused: () => new Error('refused'),
        },
        {
          exec: async () => {
            throw new Error('private stderr');
          },
        },
      ),
    );
    await expect(runtime.exec('c', ['x'])).rejects.toThrow(
      'bounded call failed',
    );
    await expect(runtime.inspect([ID])).rejects.toThrow('bounded call failed');
  });

  test('a refused bound stops the call before it starts', async () => {
    let ran = false;
    const runtime = dockerRuntimeAccess(
      budgetedDockerRun(
        {
          bounds: () => {
            throw new Error('deadline spent');
          },
          failed: () => new Error('failed'),
          refused: () => new Error('refused'),
        },
        {
          exec: async () => {
            ran = true;
            return ok();
          },
        },
      ),
    );
    await expect(runtime.list({ stack: 'tale' })).rejects.toThrow(
      'deadline spent',
    );
    expect(ran).toBe(false);
  });

  test('budgetedExec runs any command under the budget, keeping its own options', async () => {
    const calls: Call[] = [];
    const run = budgetedExec(
      {
        bounds: () => ({ timeout: 15, maxOutputBytes: 1_048_576 }),
        failed: () => new Error('failed'),
        refused: () => new Error('refused'),
      },
      {
        exec: async (command, args, options) => {
          calls.push({ command, args, options });
          return refusedResult;
        },
        environment: () => ({ PATH: '/bin' }),
      },
    );
    expect(
      (await run('docker', ['ps'], { cwd: '/x', timeout: 600 })).success,
    ).toBe(false);
    expect(calls).toEqual([
      {
        command: 'docker',
        args: ['ps'],
        options: {
          cwd: '/x',
          silent: true,
          timeout: 15,
          maxOutputBytes: 1_048_576,
          env: { PATH: '/bin' },
        },
      },
    ]);
  });
});

describe('managed command access', () => {
  test('runs each verb as one runtimeCommand, with its bounds and sentences', async () => {
    const calls: Call[] = [];
    let answer: ExecResult = ok('{}');
    const runtime = managedCommandAccess({
      exec: async (command, args, options) => {
        calls.push({ command, args, options });
        return answer;
      },
    });
    await runtime.exec(ID, ['timeout', '15', 'bun', '-e', 'x'], {
      tag: { timeout: 20 },
    });
    await runtime.stop([ID], { tag: { timeout: 60, maxOutputBytes: 1024 } });
    expect(calls.map((call) => call.args)).toEqual([
      ['exec', ID, 'timeout', '15', 'bun', '-e', 'x'],
      ['stop', '--time=-1', ID],
    ]);
    expect(calls[0].options).toMatchObject({ silent: true, timeout: 20 });
    expect(calls[1].options).toMatchObject({
      timeout: 60,
      maxOutputBytes: 1024,
    });
    answer = refusedResult;
    const error = await runtime.restart(ID, 30).catch((caught) => caught);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain(
      'Docker refused the managed runtime operation.',
    );
    expect(
      (await runtime.exec(ID, ['true'], { allowFailure: true })).success,
    ).toBe(false);
    await expect(runtime.exec(ID, ['sh'], { stdin: 'x' })).rejects.toThrow(
      'takes no stdin',
    );
  });
});

describe.skipIf(process.platform === 'win32')('execSession', () => {
  test('starts `docker exec -i` with its pipes open and the Docker settings alone', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'tale-runtime-access-'));
    const saved = process.env.PATH;
    const savedSecret = process.env.TALE_TEST_UNUSED_SECRET;
    try {
      writeFileSync(
        join(bin, 'docker'),
        '#!/bin/sh\nprintf "%s\\n" "$@"\nprintf "secret=%s\\n" "${TALE_TEST_UNUSED_SECRET:-}"\ncat\n',
      );
      chmodSync(join(bin, 'docker'), 0o755);
      process.env.PATH = `${bin}:${saved ?? ''}`;
      process.env.TALE_TEST_UNUSED_SECRET = 'leak';
      const session = dockerRuntimeAccess().execSession(ID, [
        'sh',
        '-c',
        'psql',
      ]);
      session.stdin.write('SELECT 1;\n');
      await session.stdin.end();
      const output = await new Response(session.stdout).text();
      expect(await session.exited).toBe(0);
      expect(output.split('\n')).toEqual([
        'exec',
        '-i',
        ID,
        'sh',
        '-c',
        'psql',
        'secret=',
        'SELECT 1;',
        '',
      ]);
    } finally {
      if (saved === undefined) delete process.env.PATH;
      else process.env.PATH = saved;
      if (savedSecret === undefined) delete process.env.TALE_TEST_UNUSED_SECRET;
      else process.env.TALE_TEST_UNUSED_SECRET = savedSecret;
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

describe('managed deployment modules', () => {
  // The modules this seam serves build no runtime argv of their own: the
  // Docker access is the one place that does, so another runtime can answer
  // every call they make.
  const MODULES = [
    'acceptance.ts',
    'acceptance-health.ts',
    'observation.ts',
    'apply.ts',
    'backend-cli.ts',
    'client-export.ts',
    'runtime-configuration.ts',
    'automation-protocol.ts',
    'automation-session.ts',
    'automation-cutover.ts',
    'tag-automation-cutover.ts',
    'tag-automation-protocol.ts',
    'runtime-spawner.ts',
  ];
  test.each(MODULES)('%s builds no docker argv', (file) => {
    const source = readFileSync(join(import.meta.dir, file), 'utf8');
    expect(source).not.toMatch(/'docker'/);
    expect(source).not.toMatch(/Bun\.spawn\(/);
    expect(source).not.toMatch(/runtimeCommand\(|protocolRead\(/);
    expect(source).not.toMatch(
      /\[\s*'(?:exec|cp|ps|inspect|container|image|volume|stop|restart)',/,
    );
  });

  test('dockerExecArgs is the argv the serving read used before the seam', () => {
    expect(dockerExecArgs(ID, ['bun'], { environment: { A: '' } })).toEqual([
      'exec',
      '--env',
      'A=',
      ID,
      'bun',
    ]);
  });
});
