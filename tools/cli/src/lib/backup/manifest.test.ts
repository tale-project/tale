import { describe, expect, test } from 'bun:test';

import {
  checkManifest,
  manifestFile,
  manifestGeneration,
  manifestSizeBytes,
  nativeSnapshotName,
  nativeSource,
  newestManifest,
  parseManifest,
  type SnapshotManifest,
} from './manifest';

const SHA = 'a'.repeat(64);
const ID = '20261113-100000-manual';

const V1 = {
  id: ID,
  createdAt: '2026-11-13T10:00:00.000Z',
  cliVersion: '1.0.0',
  platformVersion: '0.5.9',
  trigger: 'manual',
  volumes: { 'db-data': { sha256: SHA, sizeBytes: 10 } },
};

const NATIVE = {
  snapshot: `tale-${ID}`,
  createdAt: '2026-11-13T10:00:00.120Z',
  usedBytes: 4096,
  quotaBytes: 1024 ** 3,
};

const V2: SnapshotManifest = {
  schemaVersion: 2,
  id: ID,
  createdAt: '2026-11-13T10:00:01.000Z',
  cliVersion: '1.0.0',
  platformVersion: null,
  trigger: 'deploy',
  runtime: 'incus',
  freeze: {
    startedAt: '2026-11-13T10:00:00.100Z',
    endedAt: '2026-11-13T10:00:00.300Z',
  },
  volumes: {
    'db-data': { native: NATIVE },
    'config-data': { native: NATIVE, sha256: SHA, sizeBytes: 20 },
  },
};

describe('the snapshot manifest', () => {
  test('still reads v1, every volume an archive', () => {
    expect(parseManifest(JSON.stringify(V1))).toEqual(V1 as SnapshotManifest);
  });

  test('reads v2: per-volume native snapshots, archives optional beside them', () => {
    expect(parseManifest(JSON.stringify(V2))).toEqual(V2);
  });

  test('refuses a v2 volume with neither an archive nor a native snapshot, and half an archive', () => {
    expect(
      'problem' in checkManifest({ ...V2, volumes: { 'db-data': {} } }),
    ).toBe(true);
    expect(
      'problem' in
        checkManifest({
          ...V2,
          volumes: { 'db-data': { native: NATIVE, sha256: SHA } },
        }),
    ).toBe(true);
  });

  test('refuses a v1 volume without its archive, and a bad id', () => {
    expect(
      parseManifest(
        JSON.stringify({ ...V1, volumes: { 'db-data': { native: NATIVE } } }),
      ),
    ).toBeNull();
    expect(
      parseManifest(JSON.stringify({ ...V1, id: '$(rm -rf /)' })),
    ).toBeNull();
  });

  test('names generations and their files', () => {
    expect(manifestGeneration('manifest.json')).toBe(0);
    expect(manifestGeneration('manifest.12.json')).toBe(12);
    expect(manifestGeneration('db-data.tar.gz')).toBeNull();
    expect(manifestFile(3)).toBe('manifest.3.json');
    expect(() => manifestFile(0)).toThrow();
  });

  test('takes the newest generation that parses and names its own snapshot', () => {
    const text = JSON.stringify(V2);
    expect(
      newestManifest(ID, [
        { generation: 1, text: JSON.stringify(V1) },
        { generation: 2, text },
        { generation: 3, text: text.slice(0, 40) },
        {
          generation: 4,
          text: JSON.stringify({ ...V2, id: '20261112-090000-deploy' }),
        },
      ])?.generation,
    ).toBe(2);
    expect(newestManifest(ID, [{ generation: 1, text: null }])).toBeNull();
  });

  test('says where a native snapshot lives now, and what the set weighs', () => {
    expect(nativeSnapshotName(ID)).toBe(`tale-${ID}`);
    expect(() => nativeSnapshotName('x')).toThrow();
    expect(nativeSource('db-data', { native: NATIVE })).toEqual({
      volume: 'db-data',
      snapshot: `tale-${ID}`,
    });
    expect(
      nativeSource('db-data', {
        native: { ...NATIVE, volume: 'db-data.pre-restore-20261113110000' },
      })?.volume,
    ).toBe('db-data.pre-restore-20261113110000');
    expect(nativeSource('db-data', { sha256: SHA, sizeBytes: 1 })).toBeNull();
    expect(manifestSizeBytes(V2)).toBe(4096 + 20);
  });
});
