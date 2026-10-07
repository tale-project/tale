import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  publishStaticAssets,
  maintainStaticAssets,
  retainedAssetName,
  STATIC_ASSET_RETENTION_MS,
} from './static-assets';

let directory: string;
let blue: string;
let green: string;
let shared: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tale-release-assets-'));
  blue = join(directory, 'blue', 'assets');
  green = join(directory, 'green', 'assets');
  shared = join(directory, 'shared');
  await Promise.all(
    [blue, green, shared].map((path) => mkdir(path, { recursive: true })),
  );
  await writeFile(
    join(blue, '..', 'pwa-build.json'),
    JSON.stringify({
      assets: ['assets/preview-AAAAAAA1.js', 'assets/active-AAAAAAA1.js'],
    }),
  );
  await writeFile(
    join(green, '..', 'pwa-build.json'),
    JSON.stringify({
      assets: [
        'assets/preview-BBBBBBB2.js',
        'assets/preview-BBBBBBB2.css',
        'assets/inter-latin-CCCCCCC3.woff2',
      ],
    }),
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('immutable assets shared between releases', () => {
  it('refreshes a long-running colour before a later release can expire its bundles', async () => {
    await writeFile(join(blue, 'preview-AAAAAAA1.js'), 'long-running build');
    await publishStaticAssets(
      blue,
      shared,
      Date.now() - 2 * STATIC_ASSET_RETENTION_MS,
    );
    const started = Date.now();
    const stop = maintainStaticAssets(blue, shared, 10);
    try {
      await expect
        .poll(
          async () => (await stat(join(shared, 'preview-AAAAAAA1.js'))).mtimeMs,
        )
        .toBeGreaterThanOrEqual(started);
      await writeFile(join(green, 'preview-BBBBBBB2.js'), 'next release');
      await publishStaticAssets(green, shared);
      expect(await readFile(join(shared, 'preview-AAAAAAA1.js'), 'utf8')).toBe(
        'long-running build',
      );
    } finally {
      await stop();
    }
  });

  it('publishes overlapping colours completely and preserves earlier bundles', async () => {
    await writeFile(join(blue, 'preview-AAAAAAA1.js'), 'old preview');
    await writeFile(join(green, 'preview-BBBBBBB2.js'), 'new preview');
    await writeFile(join(green, 'inter-latin-CCCCCCC3.woff2'), 'new font');
    await writeFile(join(green, 'preview-BBBBBBB2.css'), 'new CSS');
    await writeFile(join(blue, 'index.html'), 'private shell');
    await writeFile(join(blue, 'logo.svg'), 'unhashed');
    await writeFile(
      join(blue, 'apple-touch-icon-180x180.png'),
      'mutable public icon',
    );
    await Promise.all([
      publishStaticAssets(blue, shared),
      publishStaticAssets(green, shared),
    ]);
    expect((await readdir(shared)).sort()).toEqual([
      'inter-latin-CCCCCCC3.woff2',
      'preview-AAAAAAA1.js',
      'preview-BBBBBBB2.css',
      'preview-BBBBBBB2.js',
    ]);
    expect(await readFile(join(shared, 'preview-AAAAAAA1.js'), 'utf8')).toBe(
      'old preview',
    );
    expect(await readFile(join(shared, 'preview-BBBBBBB2.js'), 'utf8')).toBe(
      'new preview',
    );
    await publishStaticAssets(blue, shared);
    expect(await readFile(join(shared, 'preview-AAAAAAA1.js'), 'utf8')).toBe(
      'old preview',
    );
    expect(
      (await readdir(shared)).some((name) => name.startsWith('.publish-')),
    ).toBe(false);
  });

  it('extends retention for the shipped build and expires only owned, unused artifacts', async () => {
    const now = Date.now();
    const expired = now - STATIC_ASSET_RETENTION_MS - 1_000;
    await writeFile(join(blue, 'active-AAAAAAA1.js'), 'active');
    for (const name of [
      'active-AAAAAAA1.js',
      'retired-BBBBBBB2.js',
      'operator-note.txt',
    ]) {
      await writeFile(join(shared, name), name);
      await utimes(join(shared, name), new Date(expired), new Date(expired));
    }
    await publishStaticAssets(blue, shared, now);
    expect((await readdir(shared)).sort()).toEqual([
      'active-AAAAAAA1.js',
      'operator-note.txt',
    ]);
    expect(
      (await stat(join(shared, 'active-AAAAAAA1.js'))).mtimeMs,
    ).toBeCloseTo(now, -1);
  });

  it('fails publication when the source cannot be read', async () => {
    await expect(
      publishStaticAssets(join(directory, 'missing'), shared),
    ).rejects.toThrow();
    expect(await readdir(shared)).toEqual([]);
  });

  it('refuses a malformed manifest before publishing anything', async () => {
    await writeFile(join(blue, '..', 'pwa-build.json'), '{"assets":[42]}');
    await expect(publishStaticAssets(blue, shared)).rejects.toThrow(
      'Missing immutable assets',
    );
    expect(await readdir(shared)).toEqual([]);
  });

  it.each([
    '/index.html',
    '/assets/index.html',
    '/assets/logo.svg',
    '/assets/x.js',
    '/assets/../secret-AAAAAAA1.js',
    '/assets/subdir/x-AAAAAAA1.js',
    '/assets/preview-AAAAAAA1.html',
    '/branding/preview-AAAAAAA1.js',
  ])('cannot retain %s', (pathname) => {
    expect(retainedAssetName(pathname)).toBeUndefined();
  });
});
