import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { setProjectId } from '../project/project-context';

setProjectId('tale');

const dockerMock = mock();
const isContainerRunningMock = mock();
const loggerWarnMock = mock();
const loggerInfoMock = mock();

mock.module('../docker/docker', () => ({ docker: dockerMock }));
mock.module('../docker/is-container-running', () => ({
  isContainerRunning: isContainerRunningMock,
}));
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

/** Route the `docker` mock by argv: drain-status GETs answer per call. */
function arrangeDrainStatus(jsonByCall: string[]): void {
  let i = 0;
  dockerMock.mockImplementation((...args: string[]) => {
    if (args.join(' ').includes('/api/control/drain-status')) {
      const json = jsonByCall[Math.min(i, jsonByCall.length - 1)];
      i += 1;
      return Promise.resolve(ok(json));
    }
    return Promise.resolve(ok());
  });
}

beforeEach(() => {
  isContainerRunningMock.mockResolvedValue(true);
});
afterEach(() => {
  dockerMock.mockReset();
  isContainerRunningMock.mockReset();
  loggerWarnMock.mockReset();
  loggerInfoMock.mockReset();
});

describe('drainBackend', () => {
  test('dry-run never touches the container', async () => {
    await drainBackend({ dryRun: true });
    expect(isContainerRunningMock).not.toHaveBeenCalled();
    expect(dockerMock).not.toHaveBeenCalled();
  });

  test('skips gracefully when the backend tier is not deployed', async () => {
    isContainerRunningMock.mockResolvedValue(false);
    await drainBackend({ dryRun: false });
    expect(dockerMock).not.toHaveBeenCalled();
  });

  test('drains through the control door on the api container', async () => {
    arrangeDrainStatus(['{"draining":true,"inFlight":0}']);
    await drainBackend({ dryRun: false, pollMs: 1, timeoutMs: 5_000 });
    const call = dockerMock.mock.calls
      .map((c) => c.map(String))
      .find((a) => a.join(' ').includes('/api/control/drain'));
    expect(call).toBeDefined();
    expect(call).toContain('exec');
    expect(call).toContain('tale-backend-api');
    // The token is read INSIDE the container — it must never be interpolated
    // into the argv the CLI process assembles.
    expect(call?.join(' ')).toContain('$TALE_CONTROL_TOKEN');
    expect(call?.join(' ')).toContain(
      'http://localhost:3005/api/control/drain',
    );
  });

  test('proceeds (warns) when the door is missing or refuses', async () => {
    dockerMock.mockImplementation((...args: string[]) =>
      args.join(' ').includes('-X POST')
        ? Promise.resolve(fail('curl: (22) 404'))
        : Promise.resolve(ok()),
    );
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
    isContainerRunningMock.mockResolvedValue(false);
    await endDrainBackend();
    expect(dockerMock).not.toHaveBeenCalled();
  });

  test('posts end-drain and swallows a failure (auto-expiry backstop)', async () => {
    dockerMock.mockResolvedValue(fail('boom'));
    await endDrainBackend();
    const call = dockerMock.mock.calls.map((c) => c.map(String))[0];
    expect(call?.join(' ')).toContain('/api/control/end-drain');
  });
});

describe('isBackendTierRunning', () => {
  test('is the cutover signal — the api container running', async () => {
    isContainerRunningMock.mockResolvedValue(true);
    expect(await isBackendTierRunning()).toBe(true);
    isContainerRunningMock.mockResolvedValue(false);
    expect(await isBackendTierRunning()).toBe(false);
  });
});
