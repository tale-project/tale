import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { setProjectId } from '../project/project-context';

setProjectId('tale');

const dockerMock = mock();
// A control call WITH a body rides `exec` (stdin), not `docker`.
const execMock = mock();
const loggerWarnMock = mock();
const loggerInfoMock = mock();

mock.module('../docker/docker', () => ({ docker: dockerMock }));
mock.module('../docker/exec', () => ({ exec: execMock }));
mock.module('../../utils/logger', () => ({
  info: loggerInfoMock,
  warn: loggerWarnMock,
  step: mock(),
  debug: mock(),
  error: mock(),
  success: mock(),
}));

const { drainBackend, endDrainBackend, isBackendTierRunning } =
  await import('./drain-backend');

function ok(stdout = '') {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}
function fail(stderr: string) {
  return { success: false, stdout: '', stderr, exitCode: 1 };
}

/**
 * The api is a REPLICA SET: the container to drain is discovered from compose
 * labels, so `docker ps` is part of every arrangement here. One line per
 * replica, in the colour's own compose project.
 */
const BLUE_API = 'tale-blue-backend-api-1\tbackend-api\t1\trunning';
let replicaLines = BLUE_API;

/** The control-door calls only — `ps` is discovery, not the behaviour. */
function doorCalls(): string[][] {
  return dockerMock.mock.calls
    .map((call) => call.map(String))
    .filter((call) => call[0] !== 'ps');
}

/** Route the `docker` mock by argv: drain-status GETs answer per call. */
function arrangeDrainStatus(jsonByCall: string[]): void {
  let i = 0;
  dockerMock.mockImplementation((...args: string[]) => {
    if (args[0] === 'ps') return Promise.resolve(ok(replicaLines));
    if (args.join(' ').includes('/api/control/drain-status')) {
      const json = jsonByCall[Math.min(i, jsonByCall.length - 1)];
      i += 1;
      return Promise.resolve(ok(json));
    }
    return Promise.resolve(ok());
  });
}

beforeEach(() => {
  replicaLines = BLUE_API;
  dockerMock.mockImplementation((...args: string[]) =>
    Promise.resolve(args[0] === 'ps' ? ok(replicaLines) : ok()),
  );
  execMock.mockResolvedValue(ok());
});
afterEach(() => {
  dockerMock.mockReset();
  execMock.mockReset();
  loggerWarnMock.mockReset();
  loggerInfoMock.mockReset();
});

describe('drainBackend', () => {
  test('dry-run never touches the container', async () => {
    await drainBackend({ dryRun: true });
    expect(dockerMock).not.toHaveBeenCalled();
  });

  test('skips gracefully when the backend tier is not deployed', async () => {
    replicaLines = '';
    await drainBackend({ dryRun: false });
    expect(doorCalls()).toHaveLength(0);
  });

  test('drains through the control door on a discovered api replica', async () => {
    arrangeDrainStatus(['{"draining":true,"inFlight":0}']);
    await drainBackend({ dryRun: false, pollMs: 1, timeoutMs: 5_000 });
    const call = doorCalls().find((a) =>
      a.join(' ').includes('/api/control/drain'),
    );
    expect(call).toBeDefined();
    expect(call).toContain('exec');
    expect(call).toContain('tale-blue-backend-api-1');
    // The token is read INSIDE the container — it must never be interpolated
    // into the argv the CLI process assembles.
    expect(call?.join(' ')).toContain('$TALE_CONTROL_TOKEN');
    expect(call?.join(' ')).toContain(
      'http://localhost:3005/api/control/drain',
    );
  });

  // The whole point of the colour scope: a flip drains the colour it is
  // retiring, and the colour that just took over keeps answering chats.
  test('aims the drain at one colour when given one', async () => {
    dockerMock.mockImplementation((...args: string[]) => {
      if (args[0] === 'ps') {
        // Only the blue project has replicas — the lister asks per project.
        return Promise.resolve(
          args.join(' ').includes('project=tale-blue') ? ok(BLUE_API) : ok(''),
        );
      }
      if (args.join(' ').includes('drain-status')) {
        return Promise.resolve(ok('{"draining":true,"inFlight":0}'));
      }
      return Promise.resolve(ok());
    });

    await drainBackend({
      dryRun: false,
      colour: 'blue',
      pollMs: 1,
      timeoutMs: 5_000,
    });

    const psProjects = dockerMock.mock.calls
      .map((call) => call.map(String))
      .filter((call) => call[0] === 'ps')
      .map((call) => call.join(' '));
    expect(
      psProjects.every((argv) => !argv.includes('project=tale-green')),
    ).toBe(true);
    // The colour rides the request body, which goes over stdin.
    const body = execMock.mock.calls.at(-1)?.[2] as
      | { stdin?: string }
      | undefined;
    expect(body?.stdin).toBe(JSON.stringify({ colour: 'blue' }));
  });

  test('proceeds (warns) when the door is missing or refuses', async () => {
    dockerMock.mockImplementation((...args: string[]) =>
      args[0] === 'ps'
        ? Promise.resolve(ok(replicaLines))
        : args.join(' ').includes('-X POST')
          ? Promise.resolve(fail('curl: (22) 404'))
          : Promise.resolve(ok()),
    );
    execMock.mockResolvedValue(fail('curl: (22) 404'));
    await drainBackend({ dryRun: false });
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    expect(String(loggerWarnMock.mock.calls[0]?.[0])).toContain('watchdog');
  });

  test('returns as soon as inFlight reaches 0', async () => {
    arrangeDrainStatus([
      '{"draining":true,"inFlight":2}',
      '{"draining":true,"inFlight":0}',
    ]);
    await drainBackend({ dryRun: false, pollMs: 1, timeoutMs: 5_000 });
    const infoLines = loggerInfoMock.mock.calls.map((c) => String(c[0]));
    expect(infoLines.some((l) => l.includes('finished'))).toBe(true);
  });

  test('gives up after the budget and lets the recreate proceed', async () => {
    arrangeDrainStatus(['{"draining":true,"inFlight":1}']);
    await drainBackend({ dryRun: false, pollMs: 1, timeoutMs: 10 });
    expect(String(loggerWarnMock.mock.calls[0]?.[0])).toContain(
      'recreating anyway',
    );
  });

  test('treats an unparseable status as unknown, never as zero', async () => {
    arrangeDrainStatus(['not json']);
    await drainBackend({ dryRun: false, pollMs: 1, timeoutMs: 10 });
    expect(String(loggerWarnMock.mock.calls[0]?.[0])).toContain('unknown');
  });
});

describe('endDrainBackend', () => {
  test('no-ops when the tier is absent', async () => {
    replicaLines = '';
    await endDrainBackend();
    expect(doorCalls()).toHaveLength(0);
  });

  test('posts end-drain and swallows a failure (auto-expiry backstop)', async () => {
    dockerMock.mockImplementation((...args: string[]) =>
      Promise.resolve(args[0] === 'ps' ? ok(replicaLines) : fail('boom')),
    );
    await endDrainBackend();
    expect(doorCalls()[0]?.join(' ')).toContain('/api/control/end-drain');
  });
});

describe('isBackendTierRunning', () => {
  test('is the cutover signal — at least one api replica running', async () => {
    expect(await isBackendTierRunning()).toBe(true);
    replicaLines = '';
    expect(await isBackendTierRunning()).toBe(false);
  });
});
