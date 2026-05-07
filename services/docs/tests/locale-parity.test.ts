import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONTENT_ROOT, discoverLocales, walkDocs } from './_helpers';

type Structure = { outline: number[]; codeBlocks: number };

/** Extracts structural markers (heading levels + fenced code block count) from
 *  a markdown doc after stripping frontmatter and ignoring content inside code
 *  fences. */
function extractStructure(src: string): Structure {
  let body = src;
  if (body.startsWith('---\n')) {
    const end = body.indexOf('\n---\n', 4);
    if (end !== -1) body = body.slice(end + 5);
  }

  const outline: number[] = [];
  let codeBlocks = 0;
  let inFence = false;
  let fenceMarker: string | null = null;
  let fenceLen = 0;

  for (const line of body.split('\n')) {
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const len = fence[1].length;
      if (!inFence) {
        codeBlocks++;
        inFence = true;
        fenceMarker = marker;
        fenceLen = len;
      } else if (marker === fenceMarker && len >= fenceLen) {
        inFence = false;
        fenceMarker = null;
        fenceLen = 0;
      }
      continue;
    }
    if (inFence) continue;
    const h = /^(#{1,6})\s+\S/.exec(line);
    if (h) outline.push(h[1].length);
  }
  return { outline, codeBlocks };
}

const allFiles = walkDocs();
const discovered = discoverLocales();
const baseLocales = ['de', 'fr'] as const;

function filesIn(locale: string): string[] {
  const prefix = locale + path.sep;
  return allFiles
    .filter((f) => f.startsWith(prefix))
    .map((f) => f.slice(prefix.length));
}

const englishFiles = filesIn('en').sort();
const englishSet = new Set(englishFiles);

describe('docs locale discovery', () => {
  it('has English content as the source of truth', () => {
    expect(englishFiles.length).toBeGreaterThan(0);
  });

  it('discovers expected base locales', () => {
    for (const code of baseLocales) {
      expect(discovered).toContain(code);
    }
  });
});

describe.each(baseLocales)('locale %s', (locale) => {
  const localeFiles = filesIn(locale);
  const localeSet = new Set(localeFiles);

  it('has a translated page for every English source', () => {
    const missing = englishFiles.filter((f) => !localeSet.has(f));
    expect(
      missing,
      `${locale}/ is missing ${missing.length} translated page(s):\n  ${missing.map((f) => path.join(locale, f)).join('\n  ')}`,
    ).toEqual([]);
  });

  it('has no orphan page without an English source', () => {
    const orphans = localeFiles.filter((f) => !englishSet.has(f)).sort();
    expect(
      orphans,
      `${locale}/ has ${orphans.length} orphan page(s) with no English counterpart:\n  ${orphans.map((f) => path.join(locale, f)).join('\n  ')}`,
    ).toEqual([]);
  });

  it('matches English heading outline and fenced code block count per page', () => {
    const mismatches: string[] = [];
    for (const relPath of englishFiles) {
      if (!localeSet.has(relPath)) continue;
      const basePath = path.join(CONTENT_ROOT, 'en', relPath);
      const locPath = path.join(CONTENT_ROOT, locale, relPath);
      const base = extractStructure(fs.readFileSync(basePath, 'utf8'));
      const loc = extractStructure(fs.readFileSync(locPath, 'utf8'));

      if (JSON.stringify(base.outline) !== JSON.stringify(loc.outline)) {
        mismatches.push(
          `${path.join(locale, relPath)}: heading outline differs\n      base: [${base.outline.join(',')}]\n      ${locale}:  [${loc.outline.join(',')}]`,
        );
      }
      if (base.codeBlocks !== loc.codeBlocks) {
        mismatches.push(
          `${path.join(locale, relPath)}: fenced code block count differs (base=${base.codeBlocks}, ${locale}=${loc.codeBlocks})`,
        );
      }
    }
    expect(
      mismatches,
      `${locale}/ structural drift vs English (${mismatches.length} issue(s)):\n  ${mismatches.join('\n  ')}`,
    ).toEqual([]);
  });
});
