import { afterEach, describe, expect, mock, test } from 'bun:test';

import type { DeploymentEnv } from '../../utils/load-env';
import { setProjectId } from '../project/project-context';
import { restore } from './restore';

// Seed the shared project-context singleton instead of mocking load-env —
// bun's mock.module leaks across test files in one process.
setProjectId('tale');

const listSnapshotsMock = mock();
const resolveSnapshotPrefixMock = mock();
const verifySnapshotMock = mock();
const isContainerRunningMock = mock();
const stopContainerMock = mock();
const ensureVolumesMock = mock();
const execMock = mock();
const confirmMock = mock();
const loggerInfoMock = mock();
const loggerTableMock = mock();

mock.module('../backup/list-snapshots', () => ({
  listSnapshots: listSnapshotsMock,
}));
mock.module('../backup/resolve-prefix', () => ({
  resolveSnapshotPrefix: resolveSnapshotPrefixMock,
}));
mock.module('../backup/verify-snapshot', () => ({
  verifySnapshot: verifySnapshotMock,
}));
mock.module('../docker/is-container-running', () => ({
  isContainerRunning: isContainerRunningMock,
}));
mock.module('../docker/stop-container', () => ({
  stopContainer: stopContainerMock,
}));
mock.module('../docker/ensure-volumes', () => ({
  ensureVolumes: ensureVolumesMock,
  volumeExists: mock(),
}));
mock.module('../docker/exec', () => ({ exec: execMock }));
mock.module('../../utils/prompt', () => ({ confirm: confirmMock }));
mock.module('../state/with-lock', () => ({
  withLock: (_dir: string, _cmd: string, fn: () => Promise<unknown>) => fn(),
}));
mock.module('../../utils/logger', () => ({
  info: loggerInfoMock,
  error: mock(),
  warn: mock(),
  step: mock(),
  success: mock(),
  header: mock(),
  blank: mock(),
  debug: mock(),
  notice: mock(),
  table: loggerTableMock,
}));

const env: DeploymentEnv = {
  BACKEND_UPSTREAM: '',
  GHCR_REGISTRY: 'ghcr.io/tale-project/tale',
  SITE_URL: 'https://localhost',
  HEALTH_CHECK_TIMEOUT: 1,
  DRAIN_TIMEOUT: 0,
  DEPLOY_DIR: '/tmp/tale-restore-test',
};

const MANIFEST = {
  id: '20260611-120000-deploy',
  createdAt: '2026-06-11T12:00:00.000Z',
  cliVersion: '1.0.0',
  platformVersion: '0.9.6',
  trigger: 'deploy',
  volumes: {
    'db-data': { sha256: 'a'.repeat(64), sizeBytes: 1024 },
    'convex-data': { sha256: 'b'.repeat(64), sizeBytes: 2048 },
  },
};

afterEach(() => {
  listSnapshotsMock.mockReset();
  resolveSnapshotPrefixMock.mockReset();
  verifySnapshotMock.mockReset();
  isContainerRunningMock.mockReset();
  stopContainerMock.mockReset();
  ensureVolumesMock.mockReset();
  execMock.mockReset();
  confirmMock.mockReset();
  loggerInfoMock.mockReset();
  loggerTableMock.mockReset();
});

describe('restore', () => {
  test('lists snapshots when no id is given', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);

    await restore({ env });

    expect(loggerTableMock).toHaveBeenCalled();
    expect(execMock).not.toHaveBeenCalled();
  });

  test('rejects an id with shell metacharacters before touching anything', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);

    await expect(
      restore({ env, snapshotId: '$(rm -rf /backup)' }),
    ).rejects.toThrow('Invalid snapshot id');
    expect(execMock).not.toHaveBeenCalled();
  });

  test('rejects an unknown snapshot id', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);

    await expect(
      restore({ env, snapshotId: '20990101-000000-manual' }),
    ).rejects.toThrow('not found');
    expect(execMock).not.toHaveBeenCalled();
  });

  test('refuses while project containers are running without --stop', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);
    isContainerRunningMock.mockImplementation((name: string) =>
      Promise.resolve(name === 'tale-db'),
    );

    await expect(
      restore({ env, snapshotId: MANIFEST.id, assumeYes: true }),
    ).rejects.toThrow(
      'Refusing to restore while project containers are running',
    );
    expect(execMock).not.toHaveBeenCalled();
    expect(stopContainerMock).not.toHaveBeenCalled();
  });

  test('stops the stack with --stop, verifies, and restores each volume', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);
    isContainerRunningMock.mockImplementation((name: string) =>
      Promise.resolve(name === 'tale-db'),
    );
    stopContainerMock.mockResolvedValue(true);
    verifySnapshotMock.mockResolvedValue(undefined);
    ensureVolumesMock.mockResolvedValue(true);
    execMock.mockResolvedValue({
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    await restore({
      env,
      snapshotId: MANIFEST.id,
      stop: true,
      assumeYes: true,
    });

    expect(stopContainerMock).toHaveBeenCalledWith('tale-db');
    expect(verifySnapshotMock).toHaveBeenCalledWith('tale_', MANIFEST.id);
    // One wipe+extract per volume in the manifest.
    expect(execMock).toHaveBeenCalledTimes(2);
    const scripts = execMock.mock.calls.map(
      (call) => call[1][call[1].length - 1],
    );
    expect(scripts[0]).toContain('find /data -mindepth 1 -delete');
    expect(scripts[0]).toContain(`${MANIFEST.id}/db-data.tar.gz`);
    // Prints the redeploy-the-matching-version runbook.
    const infoLines = loggerInfoMock.mock.calls.map((call) => String(call[0]));
    expect(
      infoLines.some((line) => line.includes('tale update --version 0.9.6')),
    ).toBe(true);
  });

  test('aborts when the confirmation prompt is declined', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);
    isContainerRunningMock.mockResolvedValue(false);
    confirmMock.mockResolvedValue(false);

    await expect(restore({ env, snapshotId: MANIFEST.id })).rejects.toThrow(
      'Restore aborted',
    );
    expect(verifySnapshotMock).not.toHaveBeenCalled();
    expect(execMock).not.toHaveBeenCalled();
  });
});
