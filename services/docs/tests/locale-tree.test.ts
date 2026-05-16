import { describe, expect, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { BASE_LOCALES, filesInLocale, walkDocs } from './lib/walk';

/**
 * The English tree at `docs/en/` is the source of truth. Every page under
 * it must have a translated mirror at `docs/de/<same path>` and
 * `docs/fr/<same path>`. Orphans (locale pages with no English source) are
 * also rejected — they either belong in `en/` first, or they're stale.
 *
 * Regional variants (today `de-CH`) are sparse by design and not checked
 * here — they fall back to their base locale (`de`) for any missing file.
 *
 * Outline parity (headings + code-fence count) lives in
 * `31-locale-outline.test.ts`. This file is about file presence only.
 */

const TRANSLATED_LOCALES = BASE_LOCALES.filter((l) => l !== 'en');

describe('locale tree', () => {
  const all = walkDocs();
  const en = filesInLocale('en', all);
  const enSet = new Set(en);

  it('has English content as the source of truth', () => {
    expect(en.length).toBeGreaterThan(0);
  });

  it.each(TRANSLATED_LOCALES)(
    '%s has a translated page for every English source',
    (locale) => {
      const localeFiles = new Set(filesInLocale(locale, all));
      const findings: Finding[] = en
        .filter((f) => !localeFiles.has(f))
        .map((f) => ({
          file: `${locale}/${f}`,
          line: 0,
          rule: 'locale-missing-mirror',
          detail: `English source exists at en/${f} but no ${locale} mirror`,
        }));
      assertNoFindings(findings, `${locale}/ missing translations`);
    },
  );

  it.each(TRANSLATED_LOCALES)(
    '%s has no orphan page without an English source',
    (locale) => {
      const findings: Finding[] = filesInLocale(locale, all)
        .filter((f) => !enSet.has(f))
        .map((f) => ({
          file: `${locale}/${f}`,
          line: 0,
          rule: 'locale-orphan',
          detail: `${locale} page exists but no en/${f} source — translate from en/ or delete`,
        }));
      assertNoFindings(findings, `${locale}/ orphan pages`);
    },
  );
});
