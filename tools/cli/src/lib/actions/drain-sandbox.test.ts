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

const { drainSandbox } = await import('./drain-sandbox');

function ok(stdout = '') {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}
function fail(stderr: string) {
  return { success: false, stdout: '', stderr, exitCode: 1 };
}

/**
 * Route the `docker` mock by argv: the drain-status GET returns the per-call
 * JSON; the drain POST (and anything else) succeeds with empty stdout.
 */
function arrangeDrainStatus(jsonByCall: string[]): void {
  let i = 0;
  dockerMock.mockImplementation((...args: string[]) => {
    if (args.join(' ').includes('/v1/drain-status')) {
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

describe('drainSandbox', () => {
  test('dry-run never touches the container', async () => {
    await drainSandbox({ dryRun: true });
    expect(isContainerRunningMock).not.toHaveBeenCalled();
    expect(dockerMock).not.toHaveBeenCalled();
  });

  test('skips gracefully when no sandbox container is running', async () => {
    isContainerRunningMock.mockResolvedValue(false);
    await drainSandbox({ dryRun: false });
    expect(dockerMock).not.toHaveBeenCalled();
  });

  test('proceeds (warns) when the spawner lacks the drain endpoint', async () => {
    // The drain POST itself fails → older spawner; warn and return without polling.
    dockerMock.mockImplementation((...args: string[]) =>
      args.includes('POST')
        ? Promise.resolve(fail('curl: (22) 404'))
        : Promise.resolve(ok()),
    );
    await drainSandbox({ dryRun: false });
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
  });

  test('drains via docker exec curl POST /v1/drain on the single container', async () => {
    arrangeDrainStatus(['{"inFlight":0}']);
    await drainSandbox({ dryRun: false, pollMs: 1, timeoutMs: 5_000 });
    const drainPost = dockerMock.mock.calls
      .map((c) => c.map(String))
      .find((a) => a.includes('POST'));
    expect(drainPost).toBeDefined();
    expect(drainPost).toContain('exec');
    expect(drainPost).toContain('tale-sandbox');
    expect(drainPost?.join(' ')).toContain('http://localhost:8003/v1/drain');
  });

  test('returns as soon as inFlight reaches 0', async () => {
    arrangeDrainStatus(['{"inFlight":2}', '{"inFlight":0}']);
    await drainSandbox({ dryRun: false, pollMs: 1, timeoutMs: 5_000 });
    const infoLines = loggerInfoMock.mock.calls.map((c) => String(c[0]));
    expect(infoLines.some((l) => l.includes('finished'))).toBe(true);
  });

  test('gives up and warns after the budget, leaving recreate to proceed', async () => {
    arrangeDrainStatus(['{"inFlight":1}']);
    await drainSandbox({ dryRun: false, pollMs: 1, timeoutMs: 10 });
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    const warn = String(loggerWarnMock.mock.calls[0]?.[0] ?? '');
    expect(warn).toContain('recreating anyway');
  });

  test('treats an unparseable drain-status as unknown and waits to the deadline', async () => {
    arrangeDrainStatus(['not json at all']);
    await drainSandbox({ dryRun: false, pollMs: 1, timeoutMs: 10 });
    const warn = String(loggerWarnMock.mock.calls[0]?.[0] ?? '');
    expect(warn).toContain('unknown');
  });
});
