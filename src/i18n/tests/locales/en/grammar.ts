/**
 * English grammar config. English has no closed gender list comparable to
 * German; this is a placeholder so the locale config shape is uniform.
 */

import type { LocaleGrammarConfig } from '../types';

export const GRAMMAR_EN: LocaleGrammarConfig = {
  nounGenders: [],
  indefiniteArticles: {
    m: { nom: 'a', acc: 'a', dat: 'a' },
    f: { nom: 'a', acc: 'a', dat: 'a' },
    n: { nom: 'a', acc: 'a', dat: 'a' },
  },
};
