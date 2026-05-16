import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { FORMAL_PRONOUNS } from './data/formal-pronouns';
import { assertNoFindings, type Finding } from './lib/findings';
import { isCapitalisedSentenceStart } from './lib/glossary';
import { iterProseLines, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { discoverLocales, localeOf, walkDocs } from './lib/walk';

/**
 * Reject formal pronouns in translated prose:
 *
 *   - DE: `Sie`, `Ihnen`, `Ihre`, `Ihrer`, `Ihres`, `Ihrem`, `Ihren`
 *   - FR: `vous`, `votre`, `vos` (and capitalised variants)
 *
 * Doctrine: `.agents/terminology/TERMINOLOGY_{DE,FR}.md` §1.
 *
 * German subtlety: `Sie` at sentence start can be the capitalised third-
 * person plural (`sie/Sie` = she/they/them). The heuristic in
 * `isCapitalisedSentenceStart` allows it when the preceding non-whitespace
 * character is sentence-final punctuation (or there's nothing before it).
 * Sentence-internal `Sie` is always the formal pronoun.
 *
 * French has no such ambiguity — `vous` is always the formal pronoun.
 */

describe('formal pronouns', () => {
  it('rejects Sie/vous and inflections in translated prose', () => {
    const locales = discoverLocales();
    const findings: Finding[] = [];
    const targetPages = walkDocs().filter(
      (rel) => localeOf(rel, locales) !== 'en',
    );

    for (const rel of targetPages) {
      const locale = localeOf(rel, locales);
      const key = locale === 'de-CH' ? 'de' : locale;
      const denylist = FORMAL_PRONOUNS[key];
      if (!denylist) continue;

      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { body } = parseFrontmatter(raw);

      for (const { line, text } of iterProseLines(body)) {
        for (const word of denylist) {
          // Boundary chosen to match either ASCII or umlaut-bearing neighbour.
          const re = new RegExp(
            `(^|[^A-Za-zÄÖÜäöüßÀ-ÿ])${word}(?![A-Za-zÄÖÜäöüßÀ-ÿ])`,
          );
          const m = re.exec(text);
          if (!m) continue;
          // DE sentence-initial `Sie` carve-out: capitalised pronouns at
          // sentence start are likely third-person plural.
          if (key === 'de' && /^[A-ZÄÖÜ]/.test(word)) {
            const idx = m.index + (m[1].length === 0 ? 0 : 1);
            if (isCapitalisedSentenceStart(text, idx)) continue;
          }
          findings.push({
            file: rel,
            line,
            rule: 'pronoun-formal',
            detail: `"${word}" — use informal form (du/dein for DE, tu/ton for FR) per TERMINOLOGY_${key.toUpperCase()}.md`,
          });
          break; // one finding per line keeps the output readable
        }
      }
    }
    assertNoFindings(findings, 'Formal-pronoun issues');
  });
});
