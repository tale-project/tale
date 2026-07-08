import { describe, expect, it } from 'vitest';

import {
  formatBytes,
  MODULE_BLOB_KEEP_COUNT,
  MODULE_BLOB_PRUNE_BYTES_THRESHOLD,
  MODULE_BLOB_PRUNE_COUNT_THRESHOLD,
  planConvexLocalMaintenance,
  resolveLatestCachedBackendVersion,
  selectModuleBlobsToPrune,
  summarizeModuleBlobs,
  type ModuleBlobEntry,
} from './convex-local-maintenance';

function blob(path: string, mtimeMs: number, sizeBytes: number): ModuleBlobEntry {
  return { path, mtimeMs, sizeBytes };
}

describe('formatBytes', () => {
  it('formats common sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });
});

describe('selectModuleBlobsToPrune', () => {
  it('keeps the newest blobs by mtime', () => {
    const entries = [
      blob('/a.blob', 100, 10),
      blob('/b.blob', 300, 10),
      blob('/c.blob', 200, 10),
    ];
    expect(selectModuleBlobsToPrune(entries, 2)).toEqual(['/a.blob']);
  });
});

describe('summarizeModuleBlobs', () => {
  it('totals count and bytes', () => {
    expect(
      summarizeModuleBlobs([
        blob('/a.blob', 1, 100),
        blob('/b.blob', 2, 250),
      ]),
    ).toEqual({ count: 2, totalBytes: 350 });
  });
});

describe('resolveLatestCachedBackendVersion', () => {
  it('returns the lexicographically last precompiled dir', () => {
    expect(
      resolveLatestCachedBackendVersion(() => [
        'precompiled-2026-06-09-b6aaa1a',
        'precompiled-2026-07-06-44f7aa7',
        'README',
      ]),
    ).toBe('precompiled-2026-07-06-44f7aa7');
  });
});

describe('planConvexLocalMaintenance', () => {
  it('does nothing when under thresholds', () => {
    expect(
      planConvexLocalMaintenance({
        moduleStats: {
          count: MODULE_BLOB_PRUNE_COUNT_THRESHOLD,
          totalBytes: MODULE_BLOB_PRUNE_BYTES_THRESHOLD,
        },
        configuredBackendVersion: 'precompiled-2026-07-06-44f7aa7',
        latestBackendVersion: 'precompiled-2026-07-06-44f7aa7',
        skipMaintenance: false,
      }),
    ).toEqual({
      kind: 'none',
      clearSnapshotArtifacts: false,
      warning: null,
    });
  });

  it('plans a prune when blob count is high', () => {
    expect(
      planConvexLocalMaintenance({
        moduleStats: {
          count: MODULE_BLOB_PRUNE_COUNT_THRESHOLD + 1,
          totalBytes: 1,
        },
        configuredBackendVersion: null,
        latestBackendVersion: null,
        skipMaintenance: false,
      }),
    ).toEqual({
      kind: 'prune-modules',
      reason: `${MODULE_BLOB_PRUNE_COUNT_THRESHOLD + 1} module blobs (threshold ${MODULE_BLOB_PRUNE_COUNT_THRESHOLD})`,
      keepCount: MODULE_BLOB_KEEP_COUNT,
      clearSnapshotArtifacts: false,
      warning: null,
    });
  });

  it('plans a prune when byte size is high', () => {
    const action = planConvexLocalMaintenance({
      moduleStats: {
        count: 10,
        totalBytes: MODULE_BLOB_PRUNE_BYTES_THRESHOLD + 1,
      },
      configuredBackendVersion: null,
      latestBackendVersion: null,
      skipMaintenance: false,
    });
    expect(action.kind).toBe('prune-modules');
    if (action.kind !== 'prune-modules') throw new Error('expected prune');
    expect(action.reason).toContain('2.0 GB');
  });

  it('keeps dev data on backend version mismatch and only clears snapshot artifacts', () => {
    const action = planConvexLocalMaintenance({
      moduleStats: { count: 10, totalBytes: 100 },
      configuredBackendVersion: 'precompiled-2026-06-09-b6aaa1a',
      latestBackendVersion: 'precompiled-2026-07-06-44f7aa7',
      skipMaintenance: false,
    });
    expect(action).toEqual({
      kind: 'none',
      clearSnapshotArtifacts: true,
      warning: expect.stringContaining('precompiled-2026-06-09-b6aaa1a'),
    });
  });

  it('prunes modules and clears snapshot artifacts when both triggers apply', () => {
    const action = planConvexLocalMaintenance({
      moduleStats: {
        count: MODULE_BLOB_PRUNE_COUNT_THRESHOLD + 1,
        totalBytes: 100,
      },
      configuredBackendVersion: 'old',
      latestBackendVersion: 'new',
      skipMaintenance: false,
    });
    expect(action.kind).toBe('prune-modules');
    if (action.kind !== 'prune-modules') throw new Error('expected prune');
    expect(action.clearSnapshotArtifacts).toBe(true);
    expect(action.warning).toContain('contributor-setup');
  });

  it('honors the skip flag', () => {
    expect(
      planConvexLocalMaintenance({
        moduleStats: {
          count: 99_999,
          totalBytes: 20 * 1024 ** 3,
        },
        configuredBackendVersion: 'old',
        latestBackendVersion: 'new',
        skipMaintenance: true,
      }),
    ).toEqual({ kind: 'none', clearSnapshotArtifacts: false, warning: null });
  });
});
