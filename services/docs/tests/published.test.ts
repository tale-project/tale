import fs from 'node:fs';
import path from 'node:path';

import {
  parsePublished,
  publishedSlug,
  publishedSlugProblem,
} from '@tale/ui/docs/published';
import { isExternalTarget } from '@tale/ui/docs/redirects';
import { describe, expect, it } from 'vitest';

import { docPath } from '@/lib/content/paths';
import { isDocsPage, resolveMissingDocsPath } from '@/lib/near-miss';
import { buildRedirectPathMap, resolveRedirect } from '@/lib/redirects';

import { assertNoFindings, type Finding } from './lib/findings';
import { REPO_ROOT } from './lib/paths';
import { BASE_LOCALES, walkDocs } from './lib/walk';

/**
 * Contract for `docs/published.json`, the append-only ledger of every docs
 * address the site has ever published. A page that moves, merges or goes
 * away keeps its line, so this suite fails until `docs/redirects.json` sends
 * the old address somewhere: an old link, a bookmark, a search result or a
 * language model trained on the old docs never meets a 404. New pages are
 * recorded by the docs build (`scripts/build-search-index.ts`).
 */

const LEDGER_FILE = path.join(REPO_ROOT, 'docs', 'published.json');

function loadLedger(): string[] {
  return parsePublished(
    JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8')),
    'docs/published.json',
  );
}

const paths = buildRedirectPathMap();

/**
 * Where a published slug's address lands in a locale, or null: the page
 * itself, or the page an explicit or derived redirect sends it to.
 */
function landing(locale: (typeof BASE_LOCALES)[number], slug: string) {
  const route = slug === 'index' ? '' : slug;
  if (isDocsPage(locale, route)) return docPath(locale, route);
  const target = resolveRedirect(docPath(locale, route), paths);
  if (target === null) return null;
  if (isExternalTarget(target)) return target;
  const targetRoute =
    locale === 'en'
      ? target.replace(/^\//, '')
      : target.replace(new RegExp(`^/${locale}/?`), '');
  return isDocsPage(locale, targetRoute) ? target : null;
}

describe('published docs addresses', () => {
  const ledger = loadLedger();

  it('keeps the ledger sorted, unique and in URL form', () => {
    expect(ledger).toEqual([...new Set(ledger)].sort());
    const malformed = ledger.filter(
      (slug) =>
        publishedSlugProblem(slug) !== null ||
        /^(?:en|de|fr)(?:\/|$)/.test(slug),
    );
    expect(malformed, 'slugs not in URL form').toEqual([]);
  });

  it('records every page the site serves (run build:search-index)', () => {
    const recorded = new Set(ledger);
    const missing = [
      ...new Set(
        walkDocs().map((file) =>
          publishedSlug(file.replace(/^[^/]+\//, '').replace(/\.mdx?$/, '')),
        ),
      ),
    ].filter((slug) => !recorded.has(slug));
    expect(
      missing,
      'pages missing from docs/published.json — run `bun run --filter @tale/docs build:search-index`',
    ).toEqual([]);
  });

  it.each(BASE_LOCALES)(
    'every published address still answers under %s/',
    (locale) => {
      const findings: Finding[] = ledger
        .filter((slug) => landing(locale, slug) === null)
        .map((slug) => ({
          file: 'published.json',
          line: 0,
          rule: 'published-address-lost',
          detail: `${docPath(locale, slug === 'index' ? '' : slug)} was published and is now a 404 — add "${slug}" to docs/redirects.json, pointing at the page that replaced it`,
        }));
      assertNoFindings(findings, `Lost docs addresses under ${locale}/`);
    },
  );

  it.each(['de-CH', 'de-AT', 'fr-CH'])(
    'every published address in the retired %s tree lands on its base locale',
    (regional) => {
      const base = regional.slice(0, 2) as (typeof BASE_LOCALES)[number];
      const findings: Finding[] = [];
      for (const slug of ledger) {
        const address = `/${regional}${slug === 'index' ? '' : `/${slug}`}`;
        const answer = resolveMissingDocsPath(address, paths);
        const expected = landing(base, slug);
        const lands =
          answer !== null &&
          (answer.location === expected ||
            resolveRedirect(answer.location, paths) === expected);
        if (!lands) {
          findings.push({
            file: 'published.json',
            line: 0,
            rule: 'regional-address-lost',
            detail: `${address} answers ${answer ? answer.location : '404'}, expected ${expected ?? 'a page'}`,
          });
        }
      }
      assertNoFindings(findings, `Lost ${regional} addresses`);
    },
  );
});
