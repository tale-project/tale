import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { DeploymentEnv } from '../../utils/load-env';
import {
  resolveOutputMode,
  setActiveOutputMode,
} from '../../utils/output-mode';
import { setProjectId } from '../project/project-context';
import { reset } from './reset';

// Seed the shared project-context singleton instead of mocking load-env —
// bun's mock.module leaks across test files in one process.
setProjectId('tale');

const dockerMock = mock();
const removeContainerMock = mock();
const confirmMock = mock();
const loggerWarnMock = mock();

mock.module('../docker/docker', () => ({ docker: dockerMock }));
mock.module('../docker/remove-container', () => ({
  removeContainer: removeContainerMock,
}));
mock.module('../../utils/prompt', () => ({ confirm: confirmMock }));
mock.module('../state/with-lock', () => ({
  withLock: (_dir: string, _cmd: string, fn: () => Promise<unknown>) => fn(),
}));
mock.module('../../utils/logger', () => ({
  info: mock(),
  error: mock(),
  warn: loggerWarnMock,
  step: mock(),
  success: mock(),
  header: mock(),
  blank: mock(),
  debug: mock(),
  notice: mock(),
  table: mock(),
}));

const env: DeploymentEnv = {
  BACKEND_UPSTREAM: '',
  GHCR_REGISTRY: 'ghcr.io/tale-project/tale',
  SITE_URL: 'https://localhost',
  HEALTH_CHECK_TIMEOUT: 1,
  DRAIN_TIMEOUT: 0,
  // No state files live here; unlink's ENOENT is swallowed by the action.
  DEPLOY_DIR: '/tmp/tale-reset-test-does-not-exist',
};

const PRUNED = { success: true, stdout: '', stderr: '', exitCode: 0 };

function removedContainers(): string[] {
  return removeContainerMock.mock.calls.map((call) => String(call[0]));
}

beforeEach(() => {
  dockerMock.mockResolvedValue(PRUNED);
  removeContainerMock.mockResolvedValue(true);
  confirmMock.mockResolvedValue(true);
});

afterEach(() => {
  dockerMock.mockReset();
  removeContainerMock.mockReset();
  confirmMock.mockReset();
  loggerWarnMock.mockReset();
  setActiveOutputMode(resolveOutputMode({}, {}));
});

describe('reset', () => {
  test('prompts without --force and cancels on a refusal', async () => {
    confirmMock.mockResolvedValue(false);

    await reset({ env, force: false, includeStateful: false, dryRun: false });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(removeContainerMock).not.toHaveBeenCalled();
    expect(dockerMock).not.toHaveBeenCalled();
  });

  test('treats the global `tale -y` as consent when --force is absent', async () => {
    setActiveOutputMode(resolveOutputMode({ yes: true }, {}));

    await reset({ env, force: false, includeStateful: false, dryRun: false });

    // Under --yes `confirm` would have resolved to its default (false) and
    // cancelled the reset the operator asked for; the consent gate must skip it.
    expect(confirmMock).not.toHaveBeenCalled();
    expect(removedContainers()).toContain('tale-platform-blue');
    expect(removedContainers()).toContain('tale-platform-green');
    expect(dockerMock).toHaveBeenCalledWith(
      'network',
      'prune',
      '-f',
      '--filter',
      'label=project=tale',
    );
  });

  test('without --all leaves the stateful tier and the sidecar alone', async () => {
    await reset({ env, force: true, includeStateful: false, dryRun: false });

    expect(removedContainers()).not.toContain('tale-db');
    expect(removedContainers()).not.toContain('tale-bgutil-provider');
    // Volume prune is gated on --all too — volume data is not recoverable.
    expect(dockerMock).not.toHaveBeenCalledWith(
      'volume',
      'prune',
      '-f',
      '--filter',
      'label=project=tale',
    );
  });

  test('--all removes the bgutil-provider sidecar with the stateful tier', async () => {
    await reset({ env, force: true, includeStateful: true, dryRun: false });

    // Left behind, the sidecar's restart policy keeps it running after the
    // CLI is gone and pins the project network against the prune.
    expect(removedContainers()).toContain('tale-db');
    expect(removedContainers()).toContain('tale-bgutil-provider');
    expect(dockerMock).toHaveBeenCalledWith(
      'volume',
      'prune',
      '-f',
      '--filter',
      'label=project=tale',
    );
  });

  test('--dry-run removes nothing and never prompts', async () => {
    await reset({ env, force: false, includeStateful: true, dryRun: true });

    // Dry-run still passes the consent gate (it changes nothing) but then
    // only reports what it would do.
    expect(removeContainerMock).not.toHaveBeenCalled();
    expect(dockerMock).not.toHaveBeenCalled();
  });

  test('warns when the project network prune fails instead of hiding it', async () => {
    dockerMock.mockImplementation((...args: string[]) =>
      Promise.resolve(
        args[0] === 'network'
          ? {
              success: false,
              stdout: '',
              stderr: 'network tale-net has active endpoints',
              exitCode: 1,
            }
          : PRUNED,
      ),
    );

    await reset({ env, force: true, includeStateful: false, dryRun: false });

    const warnings = loggerWarnMock.mock.calls.map((call) => String(call[0]));
    expect(
      warnings.some(
        (line) =>
          line.includes('Failed to prune project networks') &&
          line.includes('active endpoints'),
      ),
    ).toBe(true);
  });
});
