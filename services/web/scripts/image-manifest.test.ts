// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  IMAGE_MANIFEST,
  type ImageManifestEntry,
} from '../app/generated/image-manifest';
import { imageManifestExpression, mergeImageManifest } from './image-manifest';

function readGeneratedManifest(
  entries: readonly ImageManifestEntry[],
): unknown {
  const directory = mkdtempSync(path.join(tmpdir(), 'tale-image-manifest-'));
  const module = path.join(directory, 'manifest.ts');
  const factory = fileURLToPath(
    new URL('../lib/images/manifest-entry.ts', import.meta.url),
  );
  try {
    writeFileSync(
      module,
      `import { imageEntry } from ${JSON.stringify(factory)};\nconst entries = ${imageManifestExpression(entries)};\nprocess.stdout.write(JSON.stringify(entries));\n`,
    );
    const run = spawnSync('bun', [module], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(run.status, run.stderr).toBe(0);
    return JSON.parse(run.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function image(id: string, width = 2880): ImageManifestEntry {
  return {
    id,
    width,
    height: 1800,
    blurDataURL: 'data:image/webp;base64,example',
    variants: {
      avif: { [width]: `/marketing/optimized/${id}-${width}.avif` },
      webp: { [width]: `/marketing/optimized/${id}-${width}.webp` },
    },
  };
}

describe('incremental marketing image manifest', () => {
  const captures = [
    image('home-inbox-de'),
    image('home-inbox-de-mobile'),
    image('home-inbox-en'),
    image('home-inbox-en-mobile'),
    image('home-inbox-fr'),
    image('home-inbox-fr-mobile'),
  ];

  it('keeps localized captures when the regular source directory is empty', () => {
    expect(mergeImageManifest(captures, [])).toEqual(captures);
  });

  it('keeps every product capture and unselected photo on a single-image update', () => {
    const current = [...captures, image('office'), image('team')];
    const revised = image('office', 1600);
    const result = mergeImageManifest(current, [revised]);
    expect(result).toHaveLength(current.length);
    expect(result).toEqual(
      expect.arrayContaining([...captures, image('team')]),
    );
    expect(result.find(({ id }) => id === 'office')).toEqual(revised);
  });

  it('replaces selected capture groups without losing ordinary images', () => {
    const legacy = [image('home-inbox'), image('home-inbox-mobile')];
    const current = [...legacy, image('home-inbox-en'), image('team')];
    const result = mergeImageManifest(current, captures, ['home-inbox']);
    expect(result).toHaveLength(captures.length + 1);
    expect(result).toEqual(
      expect.arrayContaining([...captures, image('team')]),
    );
    expect(result.map(({ id }) => id)).not.toContain('home-inbox');
    expect(result.map(({ id }) => id)).not.toContain('home-inbox-mobile');
  });

  it('produces the same ordering regardless of selection order', () => {
    expect(mergeImageManifest([], [...captures].reverse())).toEqual(
      mergeImageManifest([], captures),
    );
  });
});

describe('compact generated image data', () => {
  it('preserves every shipped URL, dimension and preview with less repeated data', () => {
    const expression = imageManifestExpression(IMAGE_MANIFEST);
    expect(readGeneratedManifest(IMAGE_MANIFEST)).toEqual(IMAGE_MANIFEST);
    expect(expression.length).toBeLessThan(
      JSON.stringify(IMAGE_MANIFEST).length / 2,
    );
  });

  it('retains nonstandard URLs and distinct format widths during updates', () => {
    const standard = image('banner');
    standard.variants.avif = { 480: '/marketing/optimized/banner-480.avif' };
    const custom = image('external');
    custom.variants.webp = { 900: '/custom/external.webp' };
    const entries = [standard, custom];
    expect(readGeneratedManifest(entries)).toEqual(entries);
  });
});
