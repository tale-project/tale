import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildRedirectPathMap,
  normalizeRequestPath,
  parseRedirects,
} from '@/lib/redirects';

import { assertNoFindings, type Finding } from './lib/findings';
import { CONTENT_ROOT, REPO_ROOT } from './lib/paths';
import { BASE_LOCALES, discoverLocales } from './lib/walk';

/**
 * Contract for `docs/redirects.json` — the old slug → new slug map behind
 * the server's 301s and the prerendered meta-refresh stubs (`lib/redirects.ts`
 * expands each locale-less entry to `en`/`de`/`fr` URLs). Four rules: the
 * file matches the expected shape (dash-case slugs, no locale prefix),
 * every target is a real page in every base locale, no source is still a
 * page (the redirect would shadow it), and no target is itself a source
 * (a chain — point the old slug at the final page instead).
 */

const REDIRECTS_FILE = path.join(REPO_ROOT, 'docs', 'redirects.json');

/** Dash-case segments separated by `/`, no leading slash — the same shape
 *  as `nav.json` slugs (`platform/workspace/prompt-library`). */
const SLUG_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

function loadRedirects(): Record<string, string> {
  return parseRedirects(JSON.parse(fs.readFileSync(REDIRECTS_FILE, 'utf-8')));
}

/** A slug's route identity: `foo/index` and `foo` serve the same URL. */
function routeOf(slug: string): string {
  return slug === 'index' ? '' : slug.replace(/\/index$/, '');
}

/** Whether a route resolves to a real page — either `<route>.md(x)` or the
 *  directory-index form `<route>/index.md(x)` serves that URL. */
function pageExistsForRoute(locale: string, route: string): boolean {
  const slugs = route === '' ? ['index'] : [route, `${route}/index`];
  return slugs.some(
    (slug) =>
      fs.existsSync(path.join(CONTENT_ROOT, locale, `${slug}.md`)) ||
      fs.existsSync(path.join(CONTENT_ROOT, locale, `${slug}.mdx`)),
  );
}

describe('redirects', () => {
  it('redirects.json parses and every slug matches the expected shape', () => {
    // `loadRedirects` throws `parseRedirects`' own message on a wrong shape.
    const redirects = loadRedirects();
    const locales = discoverLocales();
    const findings: Finding[] = [];
    for (const [from, to] of Object.entries(redirects)) {
      const roles = [
        ['source', from],
        ['target', to],
      ] as const;
      for (const [role, slug] of roles) {
        if (!SLUG_PATTERN.test(slug)) {
          findings.push({
            file: 'redirects.json',
            line: 0,
            rule: 'redirect-slug-malformed',
            detail: `${role} "${slug}" is not dash-case segments without a leading slash`,
          });
        } else if (locales.includes(slug.split('/')[0])) {
          findings.push({
            file: 'redirects.json',
            line: 0,
            rule: 'redirect-slug-locale-prefixed',
            detail: `${role} "${slug}" carries a locale prefix — slugs are locale-less; one entry covers every locale`,
          });
        }
      }
    }
    assertNoFindings(findings, 'Malformed redirect slugs');
  });

  it('rejects a redirects.json without the expected top-level shape', () => {
    expect(() => parseRedirects({})).toThrow(/"redirects" key/);
    expect(() => parseRedirects({ redirects: [] })).toThrow(
      /old slug → new slug/,
    );
    expect(() => parseRedirects({ redirects: { old: 42 } })).toThrow(
      /must map to a string slug/,
    );
  });

  it.each(BASE_LOCALES)(
    'every redirect target resolves to a real page under %s/',
    (locale) => {
      const findings: Finding[] = Object.entries(loadRedirects())
        .filter(([, to]) => !pageExistsForRoute(locale, routeOf(to)))
        .map(([from, to]) => ({
          file: `${locale}/${to}`,
          line: 0,
          rule: 'redirect-target-missing',
          detail: `redirect "${from}" → "${to}" points at no .md or .mdx file under docs/${locale}/`,
        }));
      assertNoFindings(findings, `Redirect targets missing under ${locale}/`);
    },
  );

  it('no redirect source still exists as a page', () => {
    const findings: Finding[] = [];
    for (const from of Object.keys(loadRedirects())) {
      for (const locale of BASE_LOCALES) {
        if (pageExistsForRoute(locale, routeOf(from))) {
          findings.push({
            file: `${locale}/${from}`,
            line: 0,
            rule: 'redirect-source-is-a-page',
            detail: `redirect source "${from}" still resolves to a real page under docs/${locale}/ — the redirect would shadow it`,
          });
        }
      }
    }
    assertNoFindings(findings, 'Redirect sources shadowing real pages');
  });

  it('no redirect chains — every target is a page, not another redirect', () => {
    const redirects = loadRedirects();
    const sourceByRoute = new Map(
      Object.keys(redirects).map((from) => [routeOf(from), from]),
    );
    const findings: Finding[] = [];
    for (const [from, to] of Object.entries(redirects)) {
      const next = sourceByRoute.get(routeOf(to));
      if (next !== undefined) {
        findings.push({
          file: 'redirects.json',
          line: 0,
          rule: 'redirect-chain',
          detail: `"${from}" → "${to}" chains into redirect "${next}" — point "${from}" directly at the final page`,
        });
      }
    }
    assertNoFindings(findings, 'Redirect chains');
  });

  it('expands one entry into locale-preserving URL paths', () => {
    const paths = buildRedirectPathMap({ 'old/page': 'new/page' });
    expect(paths.get('/old/page')).toBe('/new/page');
    expect(paths.get('/de/old/page')).toBe('/de/new/page');
    expect(paths.get('/fr/old/page')).toBe('/fr/new/page');
    expect(paths.size).toBe(3);
    expect(normalizeRequestPath('/old/page/')).toBe('/old/page');
    expect(normalizeRequestPath('/')).toBe('/');
  });
});
