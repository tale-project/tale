import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MOBILE_QUERY } from '@tale/ui/use-is-mobile';
import { describe, expect, it } from 'vitest';

import { phoneCaptureFile } from '../../lib/content/image-variants';

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

const isScreenshot = (src: string | undefined): src is string =>
  src !== undefined && /^\/images\/.*\.webp$/.test(src);

const INTRINSIC = ['srcset', 'sizes', 'width', 'height'];

/** What keeps the screenshot `src` of one `<picture>` from being served at
 * the width its column needs, or nothing. */
function pictureFaults(picture: string, src: string): string[] {
  const img = attributesOf(/<img\b[^>]*>/.exec(picture)?.[0] ?? '');
  const sources = [...picture.matchAll(/<source\b[^>]*>/g)].map(([tag]) =>
    attributesOf(tag),
  );
  const avif = sources.find(
    (source) => source.get('type') === 'image/avif' && !source.has('media'),
  );
  const faults = INTRINSIC.filter((name) => !img.get(name)).map(
    (name) => `no ${name}`,
  );
  if (!avif?.get('srcset') || !avif.get('sizes')) faults.push('no AVIF source');
  // Below the `md` breakpoint a screenshot with a phone capture serves that
  // capture, as AVIF and WebP, at its own intrinsic size.
  const phone = sources.filter((source) => source.has('media'));
  if (phone.length > 0 || existsSync(join(DIST, phoneCaptureFile(src)))) {
    const types = phone
      .map((source) => source.get('type') ?? '')
      .sort((a, b) => a.localeCompare(b));
    if (types.join() !== 'image/avif,image/webp') {
      faults.push(`phone sources ${types.join(' and ') || 'missing'}`);
    }
    for (const source of phone) {
      const type = source.get('type');
      if (source.get('media') !== MOBILE_QUERY) {
        faults.push(`${type} phone source for ${source.get('media')}`);
      }
      for (const attribute of INTRINSIC.filter((name) => !source.get(name))) {
        faults.push(`no ${attribute} on the ${type} phone source`);
      }
    }
    // The browser takes the first source that fits, and a source with no
    // media always does: a phone source after one would never be shown.
    const fallback = sources.findIndex((source) => !source.has('media'));
    if (
      fallback !== -1 &&
      sources.slice(fallback).some((source) => source.has('media'))
    ) {
      faults.push('a phone source after the default sources');
    }
  }
  const missing = [
    img.get('src') ?? '',
    ...candidates(img.get('srcset')),
    ...sources.flatMap((source) => candidates(source.get('srcset'))),
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
  // `sizes` and its intrinsic size, and names only files the build ships;
  // one with a phone capture offers it below the `md` breakpoint.
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
        const faults = pictureFaults(picture, src);
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
