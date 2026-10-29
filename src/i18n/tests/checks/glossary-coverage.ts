/**
 * `glossary-coverage` — heuristic that surfaces likely-missing glossary
 * entries. Counts capitalised words ≥4 chars in EN content that aren't
 * stopwords and aren't already in the glossary; reports those with ≥3
 * occurrences. Report-only.
 */

import { STOPWORDS_EN } from '../glossary/stopwords-en';
import type { Finding } from './types';
import { createCheck } from './types';

const WORD = /\b([A-Z][a-z]{3,})\b/g;

export const glossaryCoverage = createCheck({
  id: 'glossary-coverage',
  scope: 'both',
  defaultMode: 'report',
  localeFilter: (locale) => locale.id === 'en',
  run(ctx) {
    const glossary = ctx.glossary();
    const known = new Set<string>();
    for (const term of glossary.all) known.add(term.en.toLowerCase());

    const counts = new Map<
      string,
      { count: number; first: { file: string; line: number } }
    >();
    for (const fragment of ctx.scanner.fragments({ locale: 'en' })) {
      WORD.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = WORD.exec(fragment.text)) !== null) {
        const word = m[1];
        if (STOPWORDS_EN.has(word)) continue;
        if (known.has(word.toLowerCase())) continue;
        const entry = counts.get(word);
        if (entry) {
          entry.count++;
        } else {
          counts.set(word, {
            count: 1,
            first: { file: fragment.pos.file, line: fragment.pos.line },
          });
        }
      }
    }

    const findings: Finding[] = [];
    for (const [word, { count, first }] of counts) {
      if (count < 3) continue;
      findings.push({
        file: first.file,
        line: first.line,
        locale: 'en',
        rule: 'glossary-coverage',
        detail: `"${word}" appears ${count}× in EN content and is not in the glossary`,
        suggest: 'add a glossary entry or extend the stopword list',
      });
    }
    return findings;
  },
});
