import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DOCS_ROOT, discoverLocales, walkDocs } from './_helpers';

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
        // CommonMark: closing fence must match marker and be at least as long.
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

const locales = discoverLocales();
const allFiles = walkDocs();
const baseFiles = allFiles
  .filter((f) => !locales.some((l) => f === l || f.startsWith(l + path.sep)))
  .sort();

describe('docs locale discovery', () => {
  it('finds at least one locale subdirectory', () => {
    expect(locales.length).toBeGreaterThan(0);
  });

  it('finds at least one English base page', () => {
    expect(baseFiles.length).toBeGreaterThan(0);
  });
});

describe.each(locales)('locale %s', (locale) => {
  const prefix = locale + path.sep;
  const localeFiles = allFiles
    .filter((f) => f.startsWith(prefix))
    .map((f) => f.slice(prefix.length));
  const localeSet = new Set(localeFiles);

  it('has a translated page for every English source', () => {
    const missing = baseFiles.filter((f) => !localeSet.has(f));
    expect(
      missing,
      `${locale}/ is missing ${missing.length} translated page(s):\n  ${missing.map((f) => path.join(locale, f)).join('\n  ')}`,
    ).toEqual([]);
  });

  it('has no orphan page without an English source', () => {
    const baseSet = new Set(baseFiles);
    const orphans = localeFiles.filter((f) => !baseSet.has(f)).sort();
    expect(
      orphans,
      `${locale}/ has ${orphans.length} orphan page(s) with no English counterpart:\n  ${orphans.map((f) => path.join(locale, f)).join('\n  ')}`,
    ).toEqual([]);
  });

  it('matches English heading outline and fenced code block count per page', () => {
    const mismatches: string[] = [];
    for (const relPath of baseFiles) {
      if (!localeSet.has(relPath)) continue; // already reported by parity test
      const basePath = path.join(DOCS_ROOT, relPath);
      const locPath = path.join(DOCS_ROOT, locale, relPath);
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
