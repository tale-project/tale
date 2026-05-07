import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DOCS_NAV, flattenNav } from '@/lib/content/nav';

import { CONTENT_ROOT } from './_helpers';

const BASE_LOCALES = ['en', 'de', 'fr'] as const;

function fileExistsForSlug(locale: string, slug: string): boolean {
  const md = path.join(CONTENT_ROOT, locale, `${slug}.md`);
  const mdx = path.join(CONTENT_ROOT, locale, `${slug}.mdx`);
  return fs.existsSync(md) || fs.existsSync(mdx);
}

describe('docs navigation parity', () => {
  it('DOCS_NAV declares at least one tab', () => {
    expect(DOCS_NAV.length).toBeGreaterThan(0);
  });

  describe.each(BASE_LOCALES)('locale %s', (locale) => {
    const flat = flattenNav();

    it('every navigation slug resolves to a real .md or .mdx file', () => {
      const missing = flat
        .filter((entry) => !fileExistsForSlug(locale, entry.slug))
        .map((entry) => entry.slug);
      expect(
        missing,
        `${missing.length} nav entr(ies) missing under ${locale}/:\n  ${missing.join('\n  ')}`,
      ).toEqual([]);
    });
  });
});
