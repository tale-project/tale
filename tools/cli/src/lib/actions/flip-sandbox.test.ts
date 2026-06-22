import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { ServiceConfig } from '../compose/types';
import { setProjectId } from '../project/project-context';

setProjectId('tale');

const dockerMock = mock();
const dockerComposeMock = mock();
const stopContainerMock = mock();
const removeContainerMock = mock();
const waitForHealthyMock = mock();
const loggerWarnMock = mock();

mock.module('../docker/docker', () => ({ docker: dockerMock }));
mock.module('../docker/docker-compose', () => ({
  dockerCompose: dockerComposeMock,
}));
mock.module('../docker/stop-container', () => ({
  stopContainer: stopContainerMock,
}));
mock.module('../docker/remove-container', () => ({
  removeContainer: removeContainerMock,
}));
mock.module('../docker/wait-for-healthy', () => ({
  waitForHealthy: waitForHealthyMock,
}));
mock.module('../../utils/logger', () => ({
  info: mock(),
  warn: loggerWarnMock,
  step: mock(),
  debug: mock(),
  error: mock(),
  success: mock(),
}));

const { flipSandboxTier } = await import('./flip-sandbox');

const config: ServiceConfig = {
  version: '1.2.3',
  registry: 'ghcr.io/tale-project/tale',
};

function ok(stdout = '') {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}

/**
 * Route the `docker` mock by argv: drain-status returns the per-test JSON; the
 * session-container `ps -aq` returns the per-test ids; everything else
 * (network connect/disconnect, drain POST) succeeds with empty stdout.
 */
function arrangeDocker(opts: {
  drainStatusJson: string;
  sessionContainerIds?: string[];
}): void {
  dockerMock.mockImplementation((...args: string[]) => {
    const joined = args.join(' ');
    if (joined.includes('/v1/drain-status')) {
      return Promise.resolve(ok(opts.drainStatusJson));
    }
    if (args[0] === 'ps') {
      return Promise.resolve(ok((opts.sessionContainerIds ?? []).join('\n')));
    }
    return Promise.resolve(ok());
  });
}

beforeEach(() => {
  dockerComposeMock.mockResolvedValue(ok());
  waitForHealthyMock.mockResolvedValue(true);
  stopContainerMock.mockResolvedValue(true);
  removeContainerMock.mockResolvedValue(true);
});
afterEach(() => {
  dockerMock.mockReset();
  dockerComposeMock.mockReset();
  stopContainerMock.mockReset();
  removeContainerMock.mockReset();
  waitForHealthyMock.mockReset();
  loggerWarnMock.mockReset();
});

function oldSpawnerStopped(): boolean {
  // The old colour's spawner container is `tale-sandbox-blue` here.
  return stopContainerMock.mock.calls.some(
    (c) => String(c[0]) === 'tale-sandbox-blue',
  );
}

describe('flipSandboxTier teardown vs linger', () => {
  test('tears the old colour down when it has no live sessions', async () => {
    arrangeDocker({ drainStatusJson: '{"inFlight":0,"sessions":0}' });

    await flipSandboxTier({
      config,
      deployDir: '/tmp/tale-flip-test',
      currentColor: 'blue',
      nextColor: 'green',
      dryRun: false,
      streamLogs: false,
      healthTimeout: 1,
    });

    expect(oldSpawnerStopped()).toBe(true);
  });

  test('lingers the old colour when it still has live sessions', async () => {
    arrangeDocker({ drainStatusJson: '{"inFlight":0,"sessions":2}' });

    await flipSandboxTier({
      config,
      deployDir: '/tmp/tale-flip-test',
      currentColor: 'blue',
      nextColor: 'green',
      dryRun: false,
      streamLogs: false,
      healthTimeout: 1,
    });

    // Teardown skipped — the old spawner keeps running for its sessions.
    expect(oldSpawnerStopped()).toBe(false);
    const warned = loggerWarnMock.mock.calls.map((c) => String(c[0]));
    expect(warned.some((l) => l.includes('lingering'))).toBe(true);
  });
});
