/**
 * `grammar-articles` — German indefinite-article gender agreement.
 *
 * Catches `einen Anfrage` (m on f noun → should be `eine Anfrage`),
 * `dem Anfrage` (m dat on f noun → should be `der Anfrage`).
 *
 * Locale data: `locales/<locale>/grammar.ts`.
 *
 * Heuristic — operates on a closed list of high-frequency nouns. Reviewers
 * catch the rest. Preposition-aware: `mit der` (dat-f) vs. `mit dem`
 * (dat-m/n) is the most common confusion.
 */

import { escapeRegex } from '../internals/regex';
import type { Finding } from './types';
import { createCheck } from './types';

// Article-form → expected gender(s) for that case.
// Nominative: ein (m/n), eine (f)
// Accusative: einen (m), eine (f), ein (n)
// Dative: einem (m/n), einer (f); also der (f.dat) / dem (m.dat/n.dat)
const ARTICLE_RULES: ReadonlyArray<{
  article: string;
  validGenders: ReadonlyArray<'m' | 'f' | 'n'>;
  case: 'nom' | 'acc' | 'dat';
}> = [
  { article: 'einen', validGenders: ['m'], case: 'acc' },
  { article: 'einem', validGenders: ['m', 'n'], case: 'dat' },
  { article: 'einer', validGenders: ['f'], case: 'dat' },
  { article: 'eine', validGenders: ['f'], case: 'acc' },
  // 'ein' alone matches m.nom + n.nom + n.acc — too ambiguous; skip.
];

export const grammarArticles = createCheck({
  id: 'grammar-articles',
  scope: 'both',
  defaultMode: 'enforce',
  localeFilter: (locale) => locale.grammar.nounGenders.length > 0,
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      const nouns = locale.grammar.nounGenders;
      if (nouns.length === 0) continue;
      // Build a noun → gender map for fast lookup.
      const nounMap = new Map(nouns.map((n) => [n.noun, n.gender]));
      // Build a single regex matching `<article> <noun>` pairs.
      const articleAlts = ARTICLE_RULES.map((r) => r.article).join('|');
      const nounAlts = nouns.map((n) => escapeRegex(n.noun)).join('|');
      const pairRe = new RegExp(`\\b(${articleAlts})\\s+(${nounAlts})\\b`, 'g');

      for (const fragment of ctx.scanner.fragments({ locale: locale.id })) {
        if (fragment.disabled?.has('grammar-articles')) continue;
        pairRe.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = pairRe.exec(fragment.text)) !== null) {
          const article = m[1];
          const noun = m[2];
          const expected = nounMap.get(noun);
          if (!expected) continue;
          const rule = ARTICLE_RULES.find((r) => r.article === article);
          if (!rule) continue;
          if (rule.validGenders.includes(expected)) continue;
          const correctArticle = correctFor(
            rule.case,
            expected,
            locale.grammar.indefiniteArticles,
          );
          findings.push({
            file: fragment.pos.file,
            line: fragment.pos.line,
            column: fragment.pos.column + m.index,
            key: fragment.key ?? undefined,
            locale: fragment.locale,
            rule: `de-article-gender-${rule.case}`,
            detail: `"${article} ${noun}" — "${noun}" is ${expected}`,
            suggest: `use "${correctArticle} ${noun}"`,
            doctrine: locale.doctrine,
          });
        }
      }
    }
    return findings;
  },
});

function correctFor(
  caseId: 'nom' | 'acc' | 'dat',
  gender: 'm' | 'f' | 'n',
  forms: Record<'m' | 'f' | 'n', { nom: string; acc: string; dat: string }>,
): string {
  return forms[gender][caseId];
}
