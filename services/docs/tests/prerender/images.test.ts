import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = join(ROOT, 'dist');

/** Every prerendered page under `dist/`. */
function builtPages(): string[] {
  return readdirSync(DIST, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** The attributes of one tag React rendered: double-quoted, with `>` escaped
 * inside their values. */
function attributesOf(tag: string): Map<string, string> {
  return new Map(
    [...tag.matchAll(/\s([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [
      name.toLowerCase(),
      value,
    ]),
  );
}

/** The URLs of a `srcset` value, without their width descriptors. */
function candidates(srcSet: string | undefined): string[] {
  if (!srcSet) return [];
  return srcSet.split(', ').map((candidate) => candidate.split(' ')[0]);
}

const isScreenshot = (src: string | undefined) =>
  src !== undefined && /^\/images\/.*\.webp$/.test(src);

/** What keeps the screenshot of one `<picture>` from being served at the
 * width its column needs, or nothing. */
function pictureFaults(picture: string): string[] {
  const img = attributesOf(/<img\b[^>]*>/.exec(picture)?.[0] ?? '');
  const avif = attributesOf(
    /<source\b[^>]*type="image\/avif"[^>]*>/.exec(picture)?.[0] ?? '',
  );
  const faults = ['srcset', 'sizes', 'width', 'height']
    .filter((name) => !img.get(name))
    .map((name) => `no ${name}`);
  if (!avif.get('srcset') || !avif.get('sizes')) faults.push('no AVIF source');
  const missing = [
    img.get('src') ?? '',
    ...candidates(img.get('srcset')),
    ...candidates(avif.get('srcset')),
  ].filter((url) => !existsSync(join(DIST, url)));
  if (missing.length > 0) faults.push(`missing ${missing.join(', ')}`);
  return faults;
}

describe('built docs pages', () => {
  // `DocsImage` falls back to a plain lazy `<img>` for a source it has no
  // variants for, so a screenshot a page names in a way the size registry
  // does not know would ship full-size again, and shift the layout as it
  // loads, without any source check noticing. Every screenshot a built page
  // shows sits in a `<picture>` with its AVIF candidates, carries `srcset`,
  // `sizes` and its intrinsic size, and names only files the build ships.
  it('serve every screenshot responsively', () => {
    expect(existsSync(join(DIST, 'index.html'))).toBe(true);
    let shown = 0;
    const offenders: string[] = [];
    for (const file of builtPages()) {
      const page = relative(DIST, file);
      const html = readFileSync(file, 'utf8');
      for (const [picture] of html.matchAll(/<picture>[\s\S]*?<\/picture>/g)) {
        const img = /<img\b[^>]*>/.exec(picture)?.[0] ?? '';
        const src = attributesOf(img).get('src');
        if (!isScreenshot(src)) continue;
        shown += 1;
        const faults = pictureFaults(picture);
        if (faults.length > 0)
          offenders.push(`${page} ${src}: ${faults.join(', ')}`);
      }
      const outside = html.replace(/<picture>[\s\S]*?<\/picture>/g, '');
      for (const [img] of outside.matchAll(/<img\b[^>]*>/g)) {
        const src = attributesOf(img).get('src');
        if (isScreenshot(src)) offenders.push(`${page} ${src}: a plain <img>`);
      }
    }
    expect(shown).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });
});
