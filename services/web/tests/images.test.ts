import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = join(HERE, '..', 'public');
const MAX_BYTES = 200 * 1024;
const OG_MAX_BYTES = 300 * 1024;
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
    const isOg = name === 'og.png';
    const exempt = EXEMPT_NAMES.has(name);
    const budget = isOg ? OG_MAX_BYTES : MAX_BYTES;

    it(`${rel} stays under ${isOg ? '300KB' : '200KB'}`, () => {
      if (exempt) return;
      const size = statSync(file).size;
      expect(size).toBeLessThanOrEqual(budget);
    });

    it(`${rel} uses a modern format when under marketing/`, () => {
      if (!rel.startsWith('marketing/') || exempt) return;
      const lower = name.toLowerCase();
      expect(lower.endsWith('.webp') || lower.endsWith('.avif')).toBe(true);
    });
  }
});
