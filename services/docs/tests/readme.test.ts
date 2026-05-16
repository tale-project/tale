import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './lib/paths';

/**
 * Repo-root README parity.
 *
 * `README.md` is the English source of truth; every `README.<locale>.md`
 * mirror at the repo root must:
 *
 *   - Exist (we require at least one translated mirror).
 *   - Be linked from the English README so a reader on GitHub finds it.
 *   - Share the English README's heading-depth sequence — different prose,
 *     same structure. Headings inside fenced code blocks are ignored.
 *
 * This is the only test that scans repo root (everything else under
 * `tests/` scans the docs tree). Kept here rather than in a separate
 * harness because vitest discovery is happy and the imports stay simple.
 */

interface Readme {
  locale: string;
  filename: string;
  content: string;
}

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
  readmes.sort((a, b) =>
    a.locale === 'en'
      ? -1
      : b.locale === 'en'
        ? 1
        : a.locale.localeCompare(b.locale),
  );
  return readmes;
}

/** Heading-depth sequence outside fenced code blocks. CommonMark closing-fence
 *  rule applies: same character, at least as long as the opener. */
function extractOutline(src: string): number[] {
  const out: number[] = [];
  let openFence: string | null = null;
  for (const line of src.split('\n')) {
    const fence = /^\s*(`{3,}|~{3,})\s*/.exec(line);
    if (fence) {
      const marker = fence[1];
      if (openFence === null) openFence = marker;
      else if (marker[0] === openFence[0] && marker.length >= openFence.length)
        openFence = null;
      continue;
    }
    if (openFence !== null) continue;
    const h = /^(#{1,6})\s+\S/.exec(line);
    if (h) out.push(h[1].length);
  }
  return out;
}

const readmes = discoverReadmes();
const enReadme = readmes.find((r) => r.locale === 'en');
const translated = readmes.filter((r) => r.locale !== 'en');

describe('README parity', () => {
  it('the English README exists at the repo root', () => {
    expect(enReadme, 'README.md must exist at the repo root').toBeDefined();
  });

  it('at least one translated README exists', () => {
    expect(translated.length).toBeGreaterThan(0);
  });

  it('the English README links to every translated README', () => {
    if (!enReadme) return;
    const missing = translated.filter(
      (r) => !enReadme.content.includes(r.filename),
    );
    expect(
      missing.map((r) => r.filename),
      `README.md must link every translated mirror; missing:\n  ${missing.map((r) => r.filename).join('\n  ')}`,
    ).toEqual([]);
  });

  it('every translated README has the same heading outline as the English source', () => {
    if (!enReadme) return;
    const base = extractOutline(enReadme.content);
    const mismatches = translated
      .filter(
        (r) =>
          JSON.stringify(extractOutline(r.content)) !== JSON.stringify(base),
      )
      .map(
        (r) =>
          `${r.filename}: expected [${base.join(',')}], got [${extractOutline(r.content).join(',')}]`,
      );
    expect(
      mismatches,
      `README outline drift:\n  ${mismatches.join('\n  ')}`,
    ).toEqual([]);
  });
});
