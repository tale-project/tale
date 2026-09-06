import { afterEach, describe, expect, mock, test } from 'bun:test';

import type { DeploymentEnv } from '../../utils/load-env';
import {
  resolveOutputMode,
  setActiveOutputMode,
} from '../../utils/output-mode';
import { setProjectId } from '../project/project-context';
import { restore, type RestoreDeps } from './restore';

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
const loggerNoticeMock = mock();
const loggerTableMock = mock();

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
  notice: loggerNoticeMock,
  table: loggerTableMock,
}));

// The collaborators restore drives are INJECTED, not module-mocked: bun's
// mock.module is process-wide, and mocking `../backup/list-snapshots` or
// `../backup/verify-snapshot` here leaked into those modules' own test files
// whenever this file ran first (the sorted order macOS and Windows use),
// handing them a mock where they test the real implementation.
const deps: RestoreDeps = {
  listSnapshots: listSnapshotsMock,
  resolveSnapshotPrefix: resolveSnapshotPrefixMock,
  verifySnapshot: verifySnapshotMock,
  isContainerRunning: isContainerRunningMock,
  stopContainer: stopContainerMock,
};
const run = (options: Parameters<typeof restore>[0]) => restore(options, deps);

const env: DeploymentEnv = {
  BACKEND_UPSTREAM: '',
  GHCR_REGISTRY: 'ghcr.io/tale-project/tale',
  SITE_URL: 'https://localhost',
  HEALTH_CHECK_TIMEOUT: 1,
  DRAIN_TIMEOUT: 0,
  DEPLOY_DIR: '/tmp/tale-restore-test',
};

/** A snapshot from before blobs were captured: no `object-store-data` archive. */
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

const MANIFEST_WITH_BLOBS = {
  ...MANIFEST,
  id: '20260903-090000-manual',
  createdAt: '2026-09-03T09:00:00.000Z',
  trigger: 'manual',
  volumes: {
    ...MANIFEST.volumes,
    'object-store-data': { sha256: 'c'.repeat(64), sizeBytes: 4096 },
  },
};

function restoreScripts(): string[] {
  return execMock.mock.calls.map((call) => call[1][call[1].length - 1]);
}

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
  loggerNoticeMock.mockReset();
  loggerTableMock.mockReset();
});

describe('restore', () => {
  test('lists snapshots when no id is given', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);

    await run({ env });

    expect(loggerTableMock).toHaveBeenCalled();
    expect(execMock).not.toHaveBeenCalled();
  });

  test('rejects an id with shell metacharacters before touching anything', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);

    await expect(run({ env, snapshotId: '$(rm -rf /backup)' })).rejects.toThrow(
      'Invalid snapshot id',
    );
    expect(execMock).not.toHaveBeenCalled();
  });

  test('rejects an unknown snapshot id', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);

    await expect(
      run({ env, snapshotId: '20990101-000000-manual' }),
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
      run({ env, snapshotId: MANIFEST.id, assumeYes: true }),
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

    await run({
      env,
      snapshotId: MANIFEST.id,
      stop: true,
      assumeYes: true,
    });

    expect(stopContainerMock).toHaveBeenCalledWith('tale-db');
    expect(verifySnapshotMock).toHaveBeenCalledWith('tale_', MANIFEST);
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

  test('treats the global `tale -y` as consent when the local flag is absent', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);
    isContainerRunningMock.mockResolvedValue(false);
    verifySnapshotMock.mockResolvedValue(undefined);
    ensureVolumesMock.mockResolvedValue(true);
    execMock.mockResolvedValue({
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    setActiveOutputMode(resolveOutputMode({ yes: true }, {}));
    try {
      await run({ env, snapshotId: MANIFEST.id });
    } finally {
      setActiveOutputMode(resolveOutputMode({}, {}));
    }

    expect(confirmMock).not.toHaveBeenCalled();
    expect(verifySnapshotMock).toHaveBeenCalledTimes(1);
  });

  test('aborts when the confirmation prompt is declined', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);
    isContainerRunningMock.mockResolvedValue(false);
    confirmMock.mockResolvedValue(false);

    await expect(run({ env, snapshotId: MANIFEST.id })).rejects.toThrow(
      'Restore aborted',
    );
    expect(verifySnapshotMock).not.toHaveBeenCalled();
    expect(execMock).not.toHaveBeenCalled();
  });

  describe('the blob archive', () => {
    test('is restored into the blob volume when the snapshot carries one', async () => {
      resolveSnapshotPrefixMock.mockResolvedValue('tale_');
      listSnapshotsMock.mockResolvedValue([MANIFEST_WITH_BLOBS, MANIFEST]);
      isContainerRunningMock.mockResolvedValue(false);
      verifySnapshotMock.mockResolvedValue(undefined);
      ensureVolumesMock.mockResolvedValue(true);
      execMock.mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      await run({
        env,
        snapshotId: MANIFEST_WITH_BLOBS.id,
        assumeYes: true,
      });

      // The blob volume is re-created alongside the others on a fresh host.
      expect(ensureVolumesMock).toHaveBeenCalledWith(
        expect.arrayContaining(['object-store-data']),
        'tale_',
      );
      // One wipe+extract per volume — the blob archive included.
      expect(execMock).toHaveBeenCalledTimes(3);
      const blobRestore = execMock.mock.calls.find((call) =>
        String(call[1][call[1].length - 1]).includes(
          'object-store-data.tar.gz',
        ),
      );
      expect(blobRestore?.[1]).toContain('tale_object-store-data:/data');
      // Blobs are proportional to the store: the extract gets the wider bound.
      expect(blobRestore?.[2]?.timeout).toBeGreaterThan(1800);
      expect(loggerNoticeMock).not.toHaveBeenCalled();
    });

    test('is noted as absent when an older snapshot predates blob capture, and the rest restores', async () => {
      resolveSnapshotPrefixMock.mockResolvedValue('tale_');
      listSnapshotsMock.mockResolvedValue([MANIFEST_WITH_BLOBS, MANIFEST]);
      isContainerRunningMock.mockResolvedValue(false);
      verifySnapshotMock.mockResolvedValue(undefined);
      ensureVolumesMock.mockResolvedValue(true);
      execMock.mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      await run({ env, snapshotId: MANIFEST.id, assumeYes: true });

      expect(execMock).toHaveBeenCalledTimes(2);
      expect(
        restoreScripts().some((script) => script.includes('object-store-data')),
      ).toBe(false);
      const notices = loggerNoticeMock.mock.calls.map((call) =>
        String(call[0]),
      );
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('no object-store-data archive');
      expect(notices[0]).toContain('left untouched');
    });

    test('is visible in the listing: snapshots without one are marked', async () => {
      resolveSnapshotPrefixMock.mockResolvedValue('tale_');
      listSnapshotsMock.mockResolvedValue([MANIFEST_WITH_BLOBS, MANIFEST]);

      await run({ env });

      const rows = loggerTableMock.mock.calls[0][0] as [string, string][];
      const byId = new Map(rows);
      expect(byId.get(MANIFEST_WITH_BLOBS.id)).not.toContain('without blobs');
      expect(byId.get(MANIFEST.id)).toContain('without blobs');
    });
  });
});
