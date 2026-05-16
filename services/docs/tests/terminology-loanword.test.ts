import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { resolveForm, termsByCategory } from './lib/glossary';
import { iterProseLines, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { escapeRegex } from './lib/regex';
import { discoverLocales, localeOf, walkDocs } from './lib/walk';

/**
 * Narrow check for the Bucket-3 "translate-bucket" terms — the closed set of
 * English nouns that MUST translate in every translated locale:
 * `Header`, `Request`, `Email`, `Help Center`, `Billing`, `Sales Research`,
 * `Draft`, `Attachment`, `Self-hosted`, `Provider`, and the FR-only
 * `Engineering`.
 *
 * The general drift test in `terminology-ui.test.ts` also catches these,
 * but this file carries a sharper error message ("translate-bucket term
 * left English"). When both fire on the same finding, the loanword failure
 * is the one a translator wants to read.
 *
 * Doctrine: `.agents/terminology/TERMINOLOGY.md` §"Three loanword buckets".
 */

describe('translate-bucket loanwords', () => {
  it('rejects translate-bucket English nouns left untranslated in DE/FR/de-CH', () => {
    const findings: Finding[] = [];
    const locales = discoverLocales();
    const target = walkDocs().filter((rel) => localeOf(rel, locales) !== 'en');
    const terms = termsByCategory('translateBucket');

    // Precompile per-locale enforcement once; compiling regexes per line × term timed out CI.
    const enforcedByLocale = new Map<
      string,
      { en: string; native: string; re: RegExp }[]
    >();
    for (const rel of target) {
      const locale = localeOf(rel, locales);
      if (enforcedByLocale.has(locale)) continue;
      enforcedByLocale.set(
        locale,
        terms
          .map((term) => ({
            en: term.en,
            native: resolveForm(term, locale),
            re: new RegExp(`(^|[^A-Za-z])${escapeRegex(term.en)}(?![A-Za-z])`),
          }))
          .filter((entry) => entry.native !== entry.en),
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
        for (const { en, native, re } of enforced) {
          if (re.test(text)) {
            findings.push({
              file: rel,
              line,
              rule: 'loanword-untranslated',
              detail: `translate-bucket term left English: "${en}" → "${native}"`,
            });
          }
        }
      }
    }

    assertNoFindings(findings, 'Untranslated translate-bucket loanwords');
  });
});
