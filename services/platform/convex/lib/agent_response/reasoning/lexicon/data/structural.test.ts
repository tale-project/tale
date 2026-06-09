import { describe, expect, it } from 'vitest';

import {
  boundaryModeFor,
  SUPPORTED_DATASET_LOCALES,
} from '../../../../../../lib/shared/constants/dataset-locales';
import { ALL_LEXICONS } from './index';

const CATEGORIES = [
  'hardVerbs',
  'easyVerbs',
  'trivialAcks',
  'creativeVerbs',
  'analyticalVerbs',
] as const;
type Category = (typeof CATEGORIES)[number];

// Minimum per-category coverage every shipped locale must satisfy. Conservative
// so well-curated locales and the parity-expanded ones all pass; guards against
// future regressions (empty/near-empty categories degrade the difficulty prior).
const FLOORS: Record<Category, number> = {
  hardVerbs: 6,
  easyVerbs: 4,
  trivialAcks: 4,
  creativeVerbs: 4,
  analyticalVerbs: 4,
};

/** Count Unicode code points without the string-spread lint pitfall. */
const codePointLength = (s: string): number => Array.from(s).length;

describe('reasoning lexicon coverage', () => {
  it('covers every supported dataset locale (and no extras)', () => {
    const present = new Set(ALL_LEXICONS.map((l) => l.locale));
    for (const loc of SUPPORTED_DATASET_LOCALES) {
      expect(present.has(loc), `missing reasoning lexicon: ${loc}`).toBe(true);
    }
    expect(present.size).toBe(SUPPORTED_DATASET_LOCALES.length);
  });

  it('declares the canonical boundary mode per locale', () => {
    for (const lex of ALL_LEXICONS) {
      expect(lex.boundaryMode, lex.locale).toBe(boundaryModeFor(lex.locale));
    }
  });

  it('meets the per-category coverage floor', () => {
    for (const lex of ALL_LEXICONS) {
      for (const cat of CATEGORIES) {
        expect(
          lex[cat].length,
          `${lex.locale}/${cat} has ${lex[cat].length} (floor ${FLOORS[cat]})`,
        ).toBeGreaterThanOrEqual(FLOORS[cat]);
      }
    }
  });

  it('has no duplicate terms within a category', () => {
    for (const lex of ALL_LEXICONS) {
      for (const cat of CATEGORIES) {
        const seen = new Set<string>();
        for (const term of lex[cat]) {
          const key = term.toLowerCase();
          expect(seen.has(key), `${lex.locale}/${cat}: dup "${term}"`).toBe(
            false,
          );
          seen.add(key);
        }
      }
    }
  });

  it('has no single-codepoint substring-mode terms in anywhere-matched categories', () => {
    // `trivialAcks` are matched whole-message (`^…$`), so a single CJK char
    // (好/是/不, 네) only fires when it IS the entire message — safe. The other
    // categories are matched anywhere in the text, where a lone codepoint would
    // be far too broad.
    const ANYWHERE = CATEGORIES.filter((c) => c !== 'trivialAcks');
    for (const lex of ALL_LEXICONS) {
      if (lex.boundaryMode !== 'substring') continue;
      for (const cat of ANYWHERE) {
        for (const term of lex[cat]) {
          expect(
            codePointLength(term) >= 2,
            `${lex.locale}/${cat}: single-codepoint "${term}"`,
          ).toBe(true);
        }
      }
    }
  });
});
