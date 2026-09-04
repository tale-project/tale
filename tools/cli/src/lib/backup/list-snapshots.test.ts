import { afterEach, describe, expect, mock, test } from 'bun:test';

import { listSnapshots } from './list-snapshots';

const execMock = mock();
const volumeExistsMock = mock();
const loggerWarnMock = mock();

mock.module('../docker/exec', () => ({ exec: execMock }));
mock.module('../docker/ensure-volumes', () => ({
  ensureVolumes: mock(),
  volumeExists: volumeExistsMock,
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

function ok(stdout = '') {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}

const OLDER = {
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

const WITH_BLOBS = {
  id: '20260903-090000-manual',
  createdAt: '2026-09-03T09:00:00.000Z',
  cliVersion: '1.0.0',
  platformVersion: '0.5.7',
  trigger: 'manual',
  volumes: {
    ...OLDER.volumes,
    'object-store-data': { sha256: 'c'.repeat(64), sizeBytes: 4096 },
    'caddy-data': { sha256: 'd'.repeat(64), sizeBytes: 8 },
    'caddy-config': { sha256: 'e'.repeat(64), sizeBytes: 8 },
  },
};

afterEach(() => {
  execMock.mockReset();
  volumeExistsMock.mockReset();
  loggerWarnMock.mockReset();
});

describe('listSnapshots', () => {
  test('returns [] before the backups volume exists', async () => {
    volumeExistsMock.mockResolvedValue(false);

    expect(await listSnapshots('p_')).toEqual([]);
    expect(execMock).not.toHaveBeenCalled();
  });

  test('reads manifests with and without the blob archive, newest first', async () => {
    volumeExistsMock.mockResolvedValue(true);
    execMock.mockResolvedValue(
      ok(`${JSON.stringify(OLDER)}\n${JSON.stringify(WITH_BLOBS)}\n`),
    );

    const snapshots = await listSnapshots('p_');

    expect(snapshots.map((snapshot) => snapshot.id)).toEqual([
      WITH_BLOBS.id,
      OLDER.id,
    ]);
    expect(snapshots[0]?.volumes['object-store-data']).toEqual({
      sha256: 'c'.repeat(64),
      sizeBytes: 4096,
    });
    expect(snapshots[1]?.volumes['object-store-data']).toBeUndefined();
    // Read-only mount of the backups volume.
    expect(execMock.mock.calls[0][1]).toContain('p_backups:/backup:ro');
  });

  test('skips a manifest whose volume entry is malformed and keeps the rest', async () => {
    volumeExistsMock.mockResolvedValue(true);
    const torn = {
      ...WITH_BLOBS,
      volumes: { 'object-store-data': { sha256: 'c'.repeat(64) } },
    };
    execMock.mockResolvedValue(
      ok(`${JSON.stringify(torn)}\n${JSON.stringify(OLDER)}\nnot json\n`),
    );

    const snapshots = await listSnapshots('p_');

    expect(snapshots.map((snapshot) => snapshot.id)).toEqual([OLDER.id]);
    expect(loggerWarnMock).toHaveBeenCalledTimes(2);
  });

  test('throws when the backups volume cannot be read', async () => {
    volumeExistsMock.mockResolvedValue(true);
    execMock.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'permission denied',
      exitCode: 1,
    });

    await expect(listSnapshots('p_')).rejects.toThrow('Failed to list');
  });
});
