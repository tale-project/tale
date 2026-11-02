import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { IMAGE_MAX_BYTES } from '@tale/ui/images/responsive';
import { TALE_OG_IMAGE } from '@tale/ui/seo/globals';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = join(HERE, '..', 'public');
const RASTER_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif'] as const;
const EXEMPT_NAMES = new Set([
  'favicon-light.png',
  'favicon-dark.png',
  'apple-touch-icon.png',
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe('marketing public images', () => {
  const files = walk(PUBLIC_ROOT).filter((file) => {
    const lower = file.toLowerCase();
    return RASTER_EXT.some((ext) => lower.endsWith(ext));
  });

  it('finds at least the OG card', () => {
    expect(files.some((f) => f.endsWith('og.png'))).toBe(true);
  });

  for (const file of files) {
    const rel = relative(PUBLIC_ROOT, file);
    const name = rel.split(/[/\\]/).pop() ?? rel;
    const exempt = EXEMPT_NAMES.has(name);

    it(`${rel} stays under ${IMAGE_MAX_BYTES / 1024}KB`, () => {
      if (exempt) return;
      const size = statSync(file).size;
      expect(size).toBeLessThanOrEqual(IMAGE_MAX_BYTES);
    });

    it(`${rel} uses a modern format when under marketing/`, () => {
      if (!rel.startsWith('marketing/') || exempt) return;
      const lower = name.toLowerCase();
      expect(lower.endsWith('.webp') || lower.endsWith('.avif')).toBe(true);
    });
  }
});

describe('social card', () => {
  // `bun run --filter @tale/web og-card` writes it; every site's tags name
  // this size (`tests/social-card.test.ts` in docs, ui-docs and web).
  it('is the PNG of the size TALE_OG_IMAGE documents', async () => {
    const { format, width, height } = await sharp(
      join(PUBLIC_ROOT, TALE_OG_IMAGE.path),
    ).metadata();
    expect({ type: `image/${format}`, width, height }).toEqual({
      type: TALE_OG_IMAGE.type,
      width: TALE_OG_IMAGE.width,
      height: TALE_OG_IMAGE.height,
    });
  });
});
