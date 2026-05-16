import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { loadGlossary, resolveForm, shouldEnforce } from './lib/glossary';
import { iterProseLines, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { escapeRegex } from './lib/regex';
import { discoverLocales, localeOf, walkDocs } from './lib/walk';

/**
 * Translated docs must use the shipped UI labels verbatim. For every
 * `GLOSSARY.terms[]` entry whose category is in `ENFORCED_CATEGORIES`
 * (`feature`, `role`, `knowledgeEntity`, `translateBucket`) and whose
 * locale form differs from English, the English form is rejected in DE/FR/
 * de-CH prose.
 *
 * Example: the glossary maps `Customers` (en) → `Kunden` (de). If a German
 * page writes "Klicke auf **Customers**", the rendered UI shows
 * `Kunden` and the reader can't find the button. The test rejects the page.
 *
 * `_lintExclude` lets a term opt out per-locale when the English form is
 * genuinely ambiguous (e.g. `Editor` in DE: also names the workflow editor
 * surface in technical contexts).
 *
 * The narrow-scope `translateBucket`-only variant lives in
 * `terminology-loanword.test.ts` for sharper error messages.
 */

describe('UI terminology drift', () => {
  it('translated pages use the shipped UI label, not the English source', () => {
    const findings: Finding[] = [];
    const locales = discoverLocales();
    const target = walkDocs().filter((rel) => localeOf(rel, locales) !== 'en');
    const terms = loadGlossary().terms;

    // Precompile per-locale enforcement once; compiling regexes per line × term timed out CI.
    const enforcedByLocale = new Map<
      string,
      { key: string; en: string; localised: string; re: RegExp }[]
    >();
    for (const rel of target) {
      const locale = localeOf(rel, locales);
      if (enforcedByLocale.has(locale)) continue;
      enforcedByLocale.set(
        locale,
        terms
          .filter((term) => shouldEnforce(term, locale))
          .map((term) => ({
            key: term.key,
            en: term.en,
            localised: resolveForm(term, locale),
            re: new RegExp(`(^|[^A-Za-z])${escapeRegex(term.en)}(?![A-Za-z])`),
          })),
      );
    }

    for (const rel of target) {
      const locale = localeOf(rel, locales);
      const enforced = enforcedByLocale.get(locale) ?? [];
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { body } = parseFrontmatter(raw);

      for (const { line, text } of iterProseLines(body)) {
        for (const { key, en, localised, re } of enforced) {
          if (re.test(text)) {
            findings.push({
              file: rel,
              line,
              rule: 'ui-term-drift',
              detail: `"${en}" should be "${localised}" (matches shipped UI label; key=${key})`,
            });
          }
        }
      }
    }

    assertNoFindings(findings, 'UI-term drift');
  });
});
