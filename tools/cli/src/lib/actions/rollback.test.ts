import { afterEach, describe, expect, mock, test } from 'bun:test';

import type { DeploymentEnv } from '../../utils/load-env';
import { setProjectId } from '../project/project-context';
import { rollback } from './rollback';

// getProjectId() (used for container names) throws unless seeded. Seed the
// real singleton with the same id the compose generator tests use — bun's
// mock.module leaks across test files in one process, so mocking the shared
// load-env module here would break sibling suites.
setProjectId('tale');

const getCurrentColorMock = mock();
const getPreviousVersionMock = mock();
const getContainerVersionMock = mock();
const pullImageMock = mock();
const dockerComposeMock = mock();
const ensureVolumesMock = mock();
const ensureNetworkMock = mock();
const waitForHealthyMock = mock();
const stopContainerMock = mock();
const removeContainerMock = mock();
const setCurrentColorMock = mock();
const setPreviousVersionMock = mock();
const loggerInfoMock = mock();
const loggerErrorMock = mock();

mock.module('../state/with-lock', () => ({
  withLock: (_dir: string, _cmd: string, fn: () => Promise<unknown>) => fn(),
}));
mock.module('../state/get-current-color', () => ({
  getCurrentColor: getCurrentColorMock,
}));
mock.module('../state/get-previous-version', () => ({
  getPreviousVersion: getPreviousVersionMock,
}));
mock.module('../state/set-current-color', () => ({
  setCurrentColor: setCurrentColorMock,
}));
mock.module('../state/set-previous-version', () => ({
  setPreviousVersion: setPreviousVersionMock,
}));
mock.module('../docker/get-container-version', () => ({
  getContainerVersion: getContainerVersionMock,
}));
mock.module('../docker/pull-image', () => ({ pullImage: pullImageMock }));
mock.module('../docker/docker-compose', () => ({
  dockerCompose: dockerComposeMock,
}));
mock.module('../docker/ensure-volumes', () => ({
  ensureVolumes: ensureVolumesMock,
}));
mock.module('../docker/ensure-network', () => ({
  ensureNetwork: ensureNetworkMock,
}));
mock.module('../docker/wait-for-healthy', () => ({
  waitForHealthy: waitForHealthyMock,
}));
mock.module('../docker/stop-container', () => ({
  stopContainer: stopContainerMock,
}));
mock.module('../docker/remove-container', () => ({
  removeContainer: removeContainerMock,
}));
mock.module('../../utils/logger', () => ({
  info: loggerInfoMock,
  error: loggerErrorMock,
  warn: mock(),
  step: mock(),
  success: mock(),
  header: mock(),
  blank: mock(),
  debug: mock(),
}));
const env: DeploymentEnv = {
  GHCR_REGISTRY: 'ghcr.io/tale-project/tale',
  SITE_URL: 'https://tale.local',
  HEALTH_CHECK_TIMEOUT: 1,
  DRAIN_TIMEOUT: 0,
  DEPLOY_DIR: '/tmp/tale-rollback-test',
};

function expectRunbookPrinted(): void {
  const infoLines = loggerInfoMock.mock.calls.map((c) => String(c[0]));
  expect(
    infoLines.some((line) => line.includes('tale upgrade --version')),
  ).toBe(true);
  expect(infoLines.some((line) => line.includes('tale deploy --all'))).toBe(
    true,
  );
}

afterEach(() => {
  getCurrentColorMock.mockReset();
  getPreviousVersionMock.mockReset();
  getContainerVersionMock.mockReset();
  pullImageMock.mockReset();
  dockerComposeMock.mockReset();
  ensureVolumesMock.mockReset();
  ensureNetworkMock.mockReset();
  waitForHealthyMock.mockReset();
  stopContainerMock.mockReset();
  removeContainerMock.mockReset();
  setCurrentColorMock.mockReset();
  setPreviousVersionMock.mockReset();
  loggerInfoMock.mockReset();
  loggerErrorMock.mockReset();
});

describe('rollback gate', () => {
  test('refuses a minor-version rollback and prints the restore runbook', async () => {
    getCurrentColorMock.mockResolvedValue('blue');
    getPreviousVersionMock.mockResolvedValue('0.9.6');
    getContainerVersionMock.mockResolvedValue('0.10.1');

    await expect(rollback({ env })).rejects.toThrow(
      'Rollback refused: not a patch-level rollback',
    );

    expect(pullImageMock).not.toHaveBeenCalled();
    expect(setCurrentColorMock).not.toHaveBeenCalled();
    expectRunbookPrinted();
  });

  test('refuses when no previous version is recorded', async () => {
    getCurrentColorMock.mockResolvedValue('blue');
    getPreviousVersionMock.mockResolvedValue(null);

    await expect(rollback({ env })).rejects.toThrow('No previous version');

    expect(pullImageMock).not.toHaveBeenCalled();
    expectRunbookPrinted();
  });

  test('refuses when the running platform version is unknown', async () => {
    getCurrentColorMock.mockResolvedValue('blue');
    getPreviousVersionMock.mockResolvedValue('0.9.2');
    getContainerVersionMock.mockResolvedValue(null);

    await expect(rollback({ env })).rejects.toThrow('Unknown running version');

    expect(pullImageMock).not.toHaveBeenCalled();
    expectRunbookPrinted();
  });

  test('refuses when the running version is not semver-parseable', async () => {
    getCurrentColorMock.mockResolvedValue('blue');
    getPreviousVersionMock.mockResolvedValue('0.9.2');
    getContainerVersionMock.mockResolvedValue('latest');

    await expect(rollback({ env })).rejects.toThrow(
      'Rollback refused: cannot compare versions',
    );

    expect(pullImageMock).not.toHaveBeenCalled();
    expectRunbookPrinted();
  });

  test('allows a patch-level rollback to the previous version', async () => {
    getCurrentColorMock.mockResolvedValue('blue');
    getPreviousVersionMock.mockResolvedValue('0.9.2');
    getContainerVersionMock.mockResolvedValue('0.9.3');
    pullImageMock.mockResolvedValue(true);
    ensureVolumesMock.mockResolvedValue(true);
    ensureNetworkMock.mockResolvedValue(true);
    dockerComposeMock.mockResolvedValue({
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
    });
    waitForHealthyMock.mockResolvedValue(true);
    stopContainerMock.mockResolvedValue(true);
    removeContainerMock.mockResolvedValue(true);

    await rollback({ env });

    // platform, rag, crawler — the rotatable services
    expect(pullImageMock).toHaveBeenCalledTimes(3);
    expect(pullImageMock).toHaveBeenCalledWith(
      'ghcr.io/tale-project/tale/tale-platform:0.9.2',
    );
    expect(setCurrentColorMock).toHaveBeenCalledWith(env.DEPLOY_DIR, 'green');
    expect(setPreviousVersionMock).toHaveBeenCalledWith(
      env.DEPLOY_DIR,
      '0.9.3',
    );
  });
});
