import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePublished, publishedSlugProblem } from '@tale/ui/docs/published';
import { isExternalTarget } from '@tale/ui/docs/redirects';
import { describe, expect, it } from 'vitest';

import { guidePath, resolveRedirect } from '@/lib/redirects';
import { listAllContent } from '@/scripts/walk-content';

/**
 * Contract for `content/published.json`, the append-only ledger of every
 * guide address ui.tale.dev has served. A guide that moves, merges or goes
 * away keeps its line, so this suite fails until `content/redirects.json`
 * sends the old address to a guide — an old link or bookmark never meets a
 * 404. New guides are recorded by the content build (`scripts/build-content.ts`).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER = resolve(HERE, '..', 'content', 'published.json');

const ledger = parsePublished(
  JSON.parse(await readFile(LEDGER, 'utf8')),
  'services/ui-docs/content/published.json',
);
const guides = new Set((await listAllContent()).map(({ slug }) => slug));

describe('published guide addresses', () => {
  it('keeps the ledger sorted, unique and in URL form', () => {
    expect(ledger).toEqual([...new Set(ledger)].sort());
    expect(
      ledger.filter((slug) => publishedSlugProblem(slug) !== null),
    ).toEqual([]);
  });

  it('records every guide the site serves (run build:content)', () => {
    const recorded = new Set(ledger);
    expect(
      [...guides].filter((slug) => !recorded.has(slug)),
      'guides missing from content/published.json — run `bun run --filter @tale/ui-docs build:content`',
    ).toEqual([]);
  });

  it('answers every published address with a guide', () => {
    const lost = ledger.filter((slug) => {
      if (guides.has(slug)) return false;
      const target = resolveRedirect(guidePath(slug));
      if (target === null) return true;
      if (isExternalTarget(target)) return false;
      return !guides.has(target.replace(/^\/docs\//, ''));
    });
    expect(
      lost,
      'published guides that now 404 — add each to content/redirects.json, pointing at the guide that replaced it (never delete the ledger line; see content/README.md)',
    ).toEqual([]);
  });
});
