import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const runConvexAdminMock = mock();
const findPlatformContainerMock = mock();
const loggerWarnMock = mock();
const loggerInfoMock = mock();

// Capture real exports before mock.module replaces the module for this process.
const realConvexRun = await import('../docker/convex-run');

mock.module('../docker/find-platform-container', () => ({
  findPlatformContainer: findPlatformContainerMock,
}));
// Partial mock: stub only `runConvexAdmin` so later test files still see the
// real banner/JSON helpers (Bun on Windows keeps mock.module global per run).
mock.module('../docker/convex-run', () => ({
  ...realConvexRun,
  runConvexAdmin: runConvexAdminMock,
  redactAdminKey: (s: string) => s,
}));
mock.module('../../utils/logger', () => ({
  info: loggerInfoMock,
  warn: loggerWarnMock,
  step: mock(),
  debug: mock(),
  error: mock(),
  success: mock(),
}));

const { drainConvex, endDrainConvex } = await import('./drain-convex');

function ok(stdout: string) {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}
function fail(stderr: string) {
  return { success: false, stdout: '', stderr, exitCode: 1 };
}

beforeEach(() => {
  findPlatformContainerMock.mockResolvedValue('tale-platform-blue');
});
afterEach(() => {
  runConvexAdminMock.mockReset();
  findPlatformContainerMock.mockReset();
  loggerWarnMock.mockReset();
  loggerInfoMock.mockReset();
});

describe('drainConvex', () => {
  test('dry-run never touches the container or the backend', async () => {
    await drainConvex({ dryRun: true });
    expect(findPlatformContainerMock).not.toHaveBeenCalled();
    expect(runConvexAdminMock).not.toHaveBeenCalled();
  });

  test('skips gracefully when no platform container is found', async () => {
    findPlatformContainerMock.mockRejectedValue(new Error('no container'));
    await drainConvex({ dryRun: false });
    expect(runConvexAdminMock).not.toHaveBeenCalled();
  });

  test('proceeds (warns) when the backend lacks the drain control plane', async () => {
    // beginDrain fails → older backend; do NOT poll, just warn and return.
    runConvexAdminMock.mockResolvedValueOnce(fail('function not found'));
    await drainConvex({ dryRun: false });
    expect(runConvexAdminMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
  });

  test('returns as soon as inFlight reaches 0', async () => {
    runConvexAdminMock
      .mockResolvedValueOnce(ok('{"inFlight":2}')) // beginDrain
      .mockResolvedValueOnce(ok('{"draining":true,"inFlight":1}')) // poll 1
      .mockResolvedValueOnce(ok('{"draining":true,"inFlight":0}')); // poll 2
    await drainConvex({ dryRun: false, pollMs: 1, timeoutMs: 5_000 });
    expect(runConvexAdminMock).toHaveBeenCalledTimes(3);
    const infoLines = loggerInfoMock.mock.calls.map((c) => String(c[0]));
    expect(infoLines.some((l) => l.includes('finished'))).toBe(true);
  });

  test('gives up and warns after the budget, leaving recreate to proceed', async () => {
    runConvexAdminMock.mockImplementation((fn: string) =>
      fn.endsWith('beginDrain')
        ? Promise.resolve(ok('{"inFlight":1}'))
        : Promise.resolve(ok('{"draining":true,"inFlight":1}')),
    );
    await drainConvex({ dryRun: false, pollMs: 1, timeoutMs: 10 });
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    const warn = String(loggerWarnMock.mock.calls[0]?.[0] ?? '');
    expect(warn).toContain('recreating anyway');
  });
});

describe('endDrainConvex', () => {
  test('clears the flag through the platform container', async () => {
    runConvexAdminMock.mockResolvedValue(ok('null'));
    await endDrainConvex();
    expect(runConvexAdminMock).toHaveBeenCalledWith(
      'control/drain:endDrain',
      expect.objectContaining({ container: 'tale-platform-blue' }),
    );
  });

  test('never throws when the container is gone', async () => {
    findPlatformContainerMock.mockRejectedValue(new Error('no container'));
    await endDrainConvex();
    expect(runConvexAdminMock).not.toHaveBeenCalled();
  });
});
