import { describe, expect, test } from 'bun:test';

import { type ReleaseInfo, selectRelease } from './self-update';

const ASSET = 'tale_linux';

function release(version: string, assets: string[] = [ASSET]): ReleaseInfo {
  return { tag: `v${version}`, version, assetNames: assets };
}

describe('selectRelease', () => {
  test('pinned: picks the highest release in the anchor line, not the newest overall', () => {
    const { best, newerLine } = selectRelease(
      [
        release('0.4.1'),
        release('0.4.0'),
        release('0.3.12'),
        release('0.3.11'),
      ],
      ASSET,
      '0.3.11',
    );
    expect(best?.version).toBe('0.3.12');
    expect(newerLine).toBe('0.4.1');
  });

  test('pinned: lines below the anchor never count as newer', () => {
    const { best, newerLine } = selectRelease(
      [release('0.3.12'), release('0.2.9')],
      ASSET,
      '0.3.11',
    );
    expect(best?.version).toBe('0.3.12');
    expect(newerLine).toBeNull();
  });

  test('pinned: a major bump counts as a newer line', () => {
    const { best, newerLine } = selectRelease(
      [release('1.0.0'), release('0.9.3')],
      ASSET,
      '0.9.2',
    );
    expect(best?.version).toBe('0.9.3');
    expect(newerLine).toBe('1.0.0');
  });

  test('pinned: skipped lists only same-line releases missing the binary', () => {
    const { best, skipped } = selectRelease(
      [
        release('0.4.0', []),
        release('0.3.14', []),
        release('0.3.13', []),
        release('0.3.12'),
      ],
      ASSET,
      '0.3.11',
    );
    expect(best?.version).toBe('0.3.12');
    expect(skipped).toEqual(['v0.3.14', 'v0.3.13']);
  });

  test('pinned: no release in the line → best is null, newer line still reported', () => {
    const { best, newerLine } = selectRelease(
      [release('0.4.0')],
      ASSET,
      '0.3.11',
    );
    expect(best).toBeNull();
    expect(newerLine).toBe('0.4.0');
  });

  test('unpinned (dev build): picks the newest release across lines', () => {
    const { best, newerLine } = selectRelease(
      [release('0.4.0'), release('0.3.12')],
      ASSET,
      null,
    );
    expect(best?.version).toBe('0.4.0');
    expect(newerLine).toBeNull();
  });

  test('unpinned: binary-less newer versions are skipped across lines', () => {
    const { best, skipped } = selectRelease(
      [release('0.4.0', []), release('0.3.12')],
      ASSET,
      null,
    );
    expect(best?.version).toBe('0.3.12');
    expect(skipped).toEqual(['v0.4.0']);
  });

  test('a release without this platform binary is never picked', () => {
    const { best } = selectRelease(
      [release('0.3.12', ['tale_windows.exe']), release('0.3.11')],
      ASSET,
      '0.3.10',
    );
    expect(best?.version).toBe('0.3.11');
  });
});
