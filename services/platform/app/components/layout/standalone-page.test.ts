import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { STANDALONE_PAGE } from './standalone-page';

/**
 * Guardrail: the platform locks document scroll (`locals.css` clips `html`,
 * `body` and `#root`), so a page outside the app shell has to scroll itself —
 * `STANDALONE_PAGE`. A `min-h-dvh` / `min-h-screen` root grows past the
 * viewport into the clipped document instead, where nothing below the fold
 * can be reached (sign-in on a phone held sideways, at 200% zoom). This pins
 * the rule for every page to come. A pure source walk (no DOM), like the
 * governance skeleton conventions.
 */
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSources(path);
    const source =
      entry.name.endsWith('.tsx') &&
      !entry.name.endsWith('.test.tsx') &&
      !entry.name.endsWith('.stories.tsx');
    return source ? [path] : [];
  });
}

describe('standalone page frame', () => {
  const files = listSources(APP_DIR);

  it('finds the app sources', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('scrolls itself at exactly the viewport height', () => {
    expect(STANDALONE_PAGE).toContain('h-dvh');
    expect(STANDALONE_PAGE).toContain('overflow-y-auto');
  });

  it('is the only way a platform page reaches the viewport height', () => {
    const offenders = files.filter((path) =>
      /\bmin-h-(?:dvh|svh|lvh|screen)\b/.test(readFileSync(path, 'utf8')),
    );
    expect(
      offenders.map((path) => relative(APP_DIR, path)),
      'A page outside the app shell grows into a document that never scrolls. Use STANDALONE_PAGE (app/components/layout/standalone-page.ts).',
    ).toEqual([]);
  });
});
