import { describe, expect, test } from 'bun:test';

import {
  selectSnapshotsToDelete,
  selectTornSnapshotDirs,
} from './rotate-snapshots';

const NOW = new Date('2026-06-11T12:00:00.000Z');

function candidate(id: string, daysAgo: number) {
  return {
    id,
    createdAt: new Date(
      NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
}

describe('selectSnapshotsToDelete', () => {
  test('keeps everything when under both windows', () => {
    const candidates = [
      candidate('a', 1),
      candidate('b', 2),
      candidate('c', 3),
    ];
    expect(selectSnapshotsToDelete(candidates, 5, 14, NOW)).toEqual([]);
  });

  test('count window protects old snapshots on a quiet instance', () => {
    // All three are far past 14 days, but they are the newest 5.
    const candidates = [
      candidate('a', 30),
      candidate('b', 60),
      candidate('c', 90),
    ];
    expect(selectSnapshotsToDelete(candidates, 5, 14, NOW)).toEqual([]);
  });

  test('age window protects recent snapshots beyond the count', () => {
    // Seven snapshots in the last week with keepCount 5: all kept,
    // because every one is newer than 14 days.
    const candidates = [1, 2, 3, 4, 5, 6, 7].map((d) => candidate(`s${d}`, d));
    expect(selectSnapshotsToDelete(candidates, 5, 14, NOW)).toEqual([]);
  });

  test('deletes only snapshots beyond the count AND past the age window', () => {
    const candidates = [
      candidate('new1', 1),
      candidate('new2', 2),
      candidate('old1', 20),
      candidate('old2', 30),
      candidate('old3', 40),
    ];
    // keepCount 3: new1, new2, old1 protected by count; old2/old3 are both
    // beyond the count and older than 14 days.
    expect(selectSnapshotsToDelete(candidates, 3, 14, NOW)).toEqual([
      'old2',
      'old3',
    ]);
  });

  test('orders by createdAt regardless of input order', () => {
    const candidates = [
      candidate('old2', 30),
      candidate('new1', 1),
      candidate('old1', 20),
    ];
    expect(selectSnapshotsToDelete(candidates, 1, 14, NOW)).toEqual([
      'old1',
      'old2',
    ]);
  });

  test('empty input selects nothing', () => {
    expect(selectSnapshotsToDelete([], 5, 14, NOW)).toEqual([]);
  });
});

describe('selectTornSnapshotDirs', () => {
  test('removes manifest-less directories older than the newest complete snapshot', () => {
    // A tar that failed before manifest.json was written leaves a partial
    // archive under a fresh id that no listing sees; once a later snapshot
    // completed, the torn one can no longer be in progress.
    expect(
      selectTornSnapshotDirs(
        ['20260601-090000-deploy', '20260603-090000-manual'],
        ['20260602-090000-deploy', '20260604-090000-deploy'],
      ),
    ).toEqual(['20260601-090000-deploy', '20260603-090000-manual']);
  });

  test('spares a manifest-less directory newer than every complete snapshot (may be in progress)', () => {
    expect(
      selectTornSnapshotDirs(
        ['20260605-090000-deploy'],
        ['20260604-090000-deploy'],
      ),
    ).toEqual([]);
  });

  test('removes nothing when no complete snapshot exists', () => {
    expect(selectTornSnapshotDirs(['20260601-090000-deploy'], [])).toEqual([]);
  });

  test('never selects a name that is not a snapshot id', () => {
    expect(
      selectTornSnapshotDirs(
        ['lost+found', '$(rm -rf /)', '20260601-090000-deploy'],
        ['20260604-090000-deploy'],
      ),
    ).toEqual(['20260601-090000-deploy']);
  });
});
