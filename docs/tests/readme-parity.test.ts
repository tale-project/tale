import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DOCS_ROOT } from './_helpers';

const REPO_ROOT = path.dirname(DOCS_ROOT);

interface Readme {
  locale: string;
  filename: string;
  content: string;
}

// Match `README.md` (English source) and any `README.<locale>.md` mirror at
// the repo root, where `<locale>` is a 2-letter language code with an
// optional 2-letter region subtag (e.g. `de`, `fr-CH`). The English file
// reports as locale `en`.
const README_PATTERN = /^README(?:\.([a-z]{2}(?:-[A-Z]{2})?))?\.md$/;

function discoverReadmes(): Readme[] {
  const readmes: Readme[] = [];
  for (const entry of fs.readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const m = README_PATTERN.exec(entry.name);
    if (!m) continue;
    readmes.push({
      locale: m[1] ?? 'en',
      filename: entry.name,
      content: fs
        .readFileSync(path.join(REPO_ROOT, entry.name), 'utf8')
        .replaceAll('\r\n', '\n'),
    });
  }
  // Sort English first, then alphabetically — keeps test output deterministic.
  readmes.sort((a, b) => {
    if (a.locale === 'en') return -1;
    if (b.locale === 'en') return 1;
    return a.locale.localeCompare(b.locale);
  });
  return readmes;
}

/** Outline = sequence of heading depths (1 for `#`, 2 for `##`, …) outside
 *  fenced code blocks. Different prose, same structure. */
function extractOutline(src: string): number[] {
  const out: number[] = [];
  let inFence = false;
  let fenceMarker: string | null = null;
  for (const line of src.split('\n')) {
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }
    if (inFence) continue;
    const h = /^(#{1,6})\s+\S/.exec(line);
    if (h) out.push(h[1].length);
  }
  return out;
}

const readmes = discoverReadmes();
const enReadme = readmes.find((r) => r.locale === 'en');
const translatedReadmes = readmes.filter((r) => r.locale !== 'en');

describe('README parity', () => {
  it('the English README exists at the repo root', () => {
    expect(
      enReadme,
      'README.md must exist at the repo root as the source of truth',
    ).toBeDefined();
  });

  it('at least one translated README exists', () => {
    expect(
      translatedReadmes.length,
      'expected at least one README.<locale>.md mirror at the repo root',
    ).toBeGreaterThan(0);
  });

  it('the English README links to every translated README', () => {
    if (!enReadme) return;
    const missing = translatedReadmes
      .filter((r) => !enReadme.content.includes(r.filename))
      .map((r) => r.filename);
    expect(
      missing,
      `README.md must contain a link to every README.<locale>.md mirror; missing:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every translated README has the same heading outline as the English source', () => {
    if (!enReadme) return;
    const baseOutline = extractOutline(enReadme.content);

    const mismatches: string[] = [];
    for (const r of translatedReadmes) {
      const outline = extractOutline(r.content);
      if (JSON.stringify(outline) !== JSON.stringify(baseOutline)) {
        mismatches.push(
          `${r.filename}: heading outline differs\n      en:    [${baseOutline.join(',')}]\n      ${r.locale}:    [${outline.join(',')}]`,
        );
      }
    }
    expect(
      mismatches,
      `${mismatches.length} README(s) have a heading outline that differs from README.md:\n  ${mismatches.join('\n  ')}`,
    ).toEqual([]);
  });
});
