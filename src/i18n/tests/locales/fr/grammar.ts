/**
 * French grammar config — placeholder. FR has gendered articles but no
 * closed-noun gender check today; reviewers cover gender disagreements.
 */

import type { LocaleGrammarConfig } from '../types';

export const GRAMMAR_FR: LocaleGrammarConfig = {
  nounGenders: [],
  indefiniteArticles: {
    m: { nom: 'un', acc: 'un', dat: 'un' },
    f: { nom: 'une', acc: 'une', dat: 'une' },
    n: { nom: 'un', acc: 'un', dat: 'un' }, // FR has no neuter; default to masc
  },
};
