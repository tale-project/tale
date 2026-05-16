import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DOCS_NAV, flattenNav } from '@/lib/content/nav';

import { assertNoFindings, type Finding } from './lib/findings';
import { CONTENT_ROOT } from './lib/paths';
import { BASE_LOCALES } from './lib/walk';

/**
 * Every entry in the navigation tree (`docs/nav.json` consumed via
 * `@/lib/content/nav`) must resolve to a real `.md` or `.mdx` file under
 * every base locale.
 *
 * The most common bug this catches: a page renamed in `en/` but not in
 * `nav.json`, leaving the sidebar pointing at a 404.
 */

function fileExistsForSlug(locale: string, slug: string): boolean {
  return (
    fs.existsSync(path.join(CONTENT_ROOT, locale, `${slug}.md`)) ||
    fs.existsSync(path.join(CONTENT_ROOT, locale, `${slug}.mdx`))
  );
}

describe('navigation', () => {
  it('DOCS_NAV declares at least one tab', () => {
    expect(DOCS_NAV.length).toBeGreaterThan(0);
  });

  it.each(BASE_LOCALES)(
    'every navigation slug resolves to a real .md or .mdx file under %s/',
    (locale) => {
      const findings: Finding[] = flattenNav()
        .filter((entry) => !fileExistsForSlug(locale, entry.slug))
        .map((entry) => ({
          file: `${locale}/${entry.slug}`,
          line: 0,
          rule: 'nav-slug-unresolved',
          detail: `nav slug "${entry.slug}" has no .md or .mdx file under docs/${locale}/`,
        }));
      assertNoFindings(findings, `Navigation entries missing under ${locale}/`);
    },
  );
});
