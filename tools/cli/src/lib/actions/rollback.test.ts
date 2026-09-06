import { afterEach, describe, expect, mock, test } from 'bun:test';

import type { DeploymentEnv } from '../../utils/load-env';
import {
  resolveOutputMode,
  setActiveOutputMode,
} from '../../utils/output-mode';
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
const confirmMock = mock();
const loggerInfoMock = mock();
const loggerErrorMock = mock();
const execMock = mock(async () => ({
  success: true,
  stdout: '',
  stderr: '',
  exitCode: 0,
}));

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
// pullImage is injected via rollback's `deps` arg (below), not mock.module:
// it's a shared module imported for real by pull-image.test.ts, and Bun's
// process-global module mock leaked into that suite and broke it on Windows.
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
// rollback pre-marks the old platform colour for shutdown via `docker exec`
// before draining. Stub it deterministically (a sibling suite's exec mock
// otherwise leaks in process-globally and returns undefined).
mock.module('../docker/exec', () => ({
  exec: execMock,
}));
mock.module('../../utils/prompt', () => ({
  confirm: confirmMock,
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
  BACKEND_UPSTREAM: '',
  GHCR_REGISTRY: 'ghcr.io/tale-project/tale',
  SITE_URL: 'https://localhost',
  HEALTH_CHECK_TIMEOUT: 1,
  DRAIN_TIMEOUT: 0,
  DEPLOY_DIR: '/tmp/tale-rollback-test',
};

function expectRunbookPrinted(): void {
  const infoLines = loggerInfoMock.mock.calls.map((c) => String(c[0]));
  expect(infoLines.some((line) => line.includes('tale update --version'))).toBe(
    true,
  );
  expect(infoLines.some((line) => line.includes('tale deploy --stop'))).toBe(
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
  confirmMock.mockReset();
  loggerInfoMock.mockReset();
  loggerErrorMock.mockReset();
  execMock.mockClear();
});

describe('rollback gate', () => {
  test('refuses a minor-version rollback and prints the restore runbook', async () => {
    getCurrentColorMock.mockResolvedValue('blue');
    getPreviousVersionMock.mockResolvedValue('0.9.6');
    getContainerVersionMock.mockResolvedValue('0.10.1');

    await expect(
      rollback({ env, assumeYes: false }, { pullImage: pullImageMock }),
    ).rejects.toThrow('Rollback refused: not a patch-level rollback');

    expect(pullImageMock).not.toHaveBeenCalled();
    expect(setCurrentColorMock).not.toHaveBeenCalled();
    expectRunbookPrinted();
  });

  test('refuses when no previous version is recorded', async () => {
    getCurrentColorMock.mockResolvedValue('blue');
    getPreviousVersionMock.mockResolvedValue(null);

    await expect(
      rollback({ env, assumeYes: false }, { pullImage: pullImageMock }),
    ).rejects.toThrow('No previous version');

    expect(pullImageMock).not.toHaveBeenCalled();
    expectRunbookPrinted();
  });

  test('refuses when the running platform version is unknown', async () => {
    getCurrentColorMock.mockResolvedValue('blue');
    getPreviousVersionMock.mockResolvedValue('0.9.2');
    getContainerVersionMock.mockResolvedValue(null);

    await expect(
      rollback({ env, assumeYes: false }, { pullImage: pullImageMock }),
    ).rejects.toThrow('Unknown running version');

    expect(pullImageMock).not.toHaveBeenCalled();
    expectRunbookPrinted();
  });

  test('refuses when the running version is not semver-parseable', async () => {
    getCurrentColorMock.mockResolvedValue('blue');
    getPreviousVersionMock.mockResolvedValue('0.9.2');
    getContainerVersionMock.mockResolvedValue('latest');

    await expect(
      rollback({ env, assumeYes: false }, { pullImage: pullImageMock }),
    ).rejects.toThrow('Rollback refused: cannot compare versions');

    expect(pullImageMock).not.toHaveBeenCalled();
    expectRunbookPrinted();
  });
});

describe('rollback confirmation', () => {
  /** Seed the mocks so a patch-level rollback passes the gate and succeeds. */
  function arrangePatchRollback(): void {
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
  }

  test('proceeds with a patch-level rollback once the operator confirms', async () => {
    arrangePatchRollback();
    confirmMock.mockResolvedValue(true);

    await rollback({ env, assumeYes: false }, { pullImage: pullImageMock });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    // platform — the only rotatable service
    expect(pullImageMock).toHaveBeenCalledTimes(1);
    expect(pullImageMock).toHaveBeenCalledWith(
      'ghcr.io/tale-project/tale/tale-platform:0.9.2',
    );
    expect(setCurrentColorMock).toHaveBeenCalledWith(env.DEPLOY_DIR, 'green');
    expect(setPreviousVersionMock).toHaveBeenCalledWith(
      env.DEPLOY_DIR,
      '0.9.3',
    );
  });

  test('aborts before pulling anything when the operator declines', async () => {
    arrangePatchRollback();
    confirmMock.mockResolvedValue(false);

    await rollback({ env, assumeYes: false }, { pullImage: pullImageMock });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(pullImageMock).not.toHaveBeenCalled();
    expect(setCurrentColorMock).not.toHaveBeenCalled();
    expect(setPreviousVersionMock).not.toHaveBeenCalled();
  });

  test('skips the prompt and proceeds when --yes is set', async () => {
    arrangePatchRollback();

    await rollback({ env, assumeYes: true }, { pullImage: pullImageMock });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(pullImageMock).toHaveBeenCalledTimes(1);
    expect(setCurrentColorMock).toHaveBeenCalledWith(env.DEPLOY_DIR, 'green');
  });

  test('treats the global `tale -y` as consent when the local flag is absent', async () => {
    // `tale -y rollback` routes `--yes` to program.opts(); the command's own
    // flag stays unset. Under the global flag `confirm` would return its
    // `default` (false) and cancel — the opposite of what was asked.
    arrangePatchRollback();
    setActiveOutputMode(resolveOutputMode({ yes: true }, {}));
    try {
      await rollback({ env }, { pullImage: pullImageMock });
    } finally {
      setActiveOutputMode(resolveOutputMode({}, {}));
    }

    expect(confirmMock).not.toHaveBeenCalled();
    expect(pullImageMock).toHaveBeenCalledTimes(1);
    expect(setCurrentColorMock).toHaveBeenCalledWith(env.DEPLOY_DIR, 'green');
  });
});
