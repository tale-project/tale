import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { NOUN_GENDERS_DE, type Gender } from './data/noun-genders-de';
import { assertNoFindings, type Finding } from './lib/findings';
import { iterProseLines, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { escapeRegex } from './lib/regex';
import { localeOf, walkDocs } from './lib/walk';

/**
 * German indefinite-article + gender agreement, hard-fail.
 *
 * Catches the most common class of translation bug — an indefinite article
 * that disagrees in case+gender with the noun it governs:
 *
 *   `einen einmaligen Warnung`  (masc-acc article on a feminine noun)
 *   `eine Token`                (fem article on a neuter noun)
 *   `einer Anbieter`            (fem dat/gen article on a masculine noun)
 *
 * The closed list of nouns lives in `data/noun-genders-de.ts`. Definite-
 * article cases (`der/die/das/dem/den/des`) are ambiguous across
 * case+number and are deliberately out of scope.
 *
 * ## Precision tightening (vs the legacy `grammar-de.test.ts`)
 *
 * The old regex matched any tracked noun within two words of an article,
 * which produced false positives like `einen Chunk pro Token` — here the
 * article governs `Chunk`, not `Token`. Two fixes:
 *
 *   1. **Stop at prepositions.** A negative lookahead in the
 *      "in-between word" repetition aborts the match when one of the
 *      prepositions in `STOP_PREPOSITIONS` appears between article and
 *      noun. `pro`, `mit`, `für`, `von`, etc. all end the noun phrase.
 *
 *   2. **Lowercase-leading in-between words.** Adjectives start with a
 *      lowercase letter in attributive position; a capitalised word in
 *      between would be another noun, meaning we're already past the noun
 *      the article governs. We restrict in-between words to
 *      `[a-zäöüß][\w-]*`.
 *
 * The combined effect is precise enough to land hard-fail.
 */

interface MatchInfo {
  match: string;
  article: keyof typeof ARTICLE_ALLOWED;
  noun: string;
  nounGender: Gender;
}

/**
 * Articles whose case+gender combination is unambiguous. Each article maps
 * to the noun genders it CAN govern. A mismatch is a bug.
 *
 *   einen — masc acc            → m
 *   eine  — fem nom/acc         → f
 *   einem — masc/neut dat       → m, n
 *   einer — fem dat/gen         → f
 *   eines — masc/neut gen       → m, n
 *
 * `ein` is omitted: ambiguous between masc-nom and neut-nom/acc.
 */
const ARTICLE_ALLOWED = {
  einen: ['m'] as Gender[],
  eine: ['f'] as Gender[],
  einem: ['m', 'n'] as Gender[],
  einer: ['f'] as Gender[],
  eines: ['m', 'n'] as Gender[],
} as const;

/**
 * Prepositions that end the noun phrase governed by the article. When one
 * appears between the article and the next tracked noun, the article does
 * not govern that noun — the preposition opens a new phrase.
 */
const STOP_PREPOSITIONS = [
  'pro',
  'mit',
  'für',
  'fuer',
  'von',
  'aus',
  'bei',
  'nach',
  'seit',
  'zu',
  'gegen',
  'ohne',
  'um',
  'durch',
  'als',
  'in',
  'an',
  'auf',
  'unter',
  'über',
];

describe('German indefinite-article gender agreement', () => {
  it('rejects einen/eine/einem/einer/eines that disagree with the governed noun', () => {
    const findings: Finding[] = [];
    const pages = walkDocs().filter((rel) => {
      const loc = localeOf(rel);
      return loc === 'de' || loc === 'de-CH';
    });

    const articleAlt = Object.keys(ARTICLE_ALLOWED).join('|');
    const nounAlt = Object.keys(NOUN_GENDERS_DE).map(escapeRegex).join('|');
    const prepAlt = STOP_PREPOSITIONS.map(escapeRegex).join('|');

    // Article, then up to two lowercase-leading adjective-like words,
    // none of which is a preposition, then a tracked noun. The noun must
    // not be followed by `-` — that means it's part of a compound (e.g.
    // `Token-URL`, `Token-basierte Anmeldeberechtigung`) and the article
    // governs the compound head, not the prefix.
    const pattern = new RegExp(
      `\\b(${articleAlt})\\s+(?:(?!(?:${prepAlt})\\b)[a-zäöüß][\\wäöüß-]*\\s+){0,2}(${nounAlt})(?![-\\wäöüß])`,
      'g',
    );

    for (const rel of pages) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { body } = parseFrontmatter(raw);

      for (const { line, text } of iterProseLines(body)) {
        for (const m of text.matchAll(pattern)) {
          const article = m[1] as keyof typeof ARTICLE_ALLOWED;
          const noun = m[2];
          const nounGender = NOUN_GENDERS_DE[noun];
          if (!nounGender) continue; // unknown noun — already filtered by regex
          const allowed = ARTICLE_ALLOWED[article];
          if (allowed.includes(nounGender)) continue;
          const info: MatchInfo = { match: m[0], article, noun, nounGender };
          findings.push({
            file: rel,
            line,
            rule: 'grammar-de-article-gender',
            detail: `"${info.match}" — article "${info.article}" disagrees with ${info.noun} (${info.nounGender})`,
          });
        }
      }
    }

    assertNoFindings(findings, 'German article/gender disagreement');
  });
});
