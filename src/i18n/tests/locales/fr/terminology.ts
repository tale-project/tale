/**
 * French terminology config — half-translated compounds + calques.
 *
 * Migrated from `services/docs/tests/data/half-compounds.ts` (FR entries).
 */

import type { HalfCompoundRule, LocaleTerminologyConfig } from '../types';

const HALF_COMPOUNDS: ReadonlyArray<HalfCompoundRule> = [
  // Git-domain compounds: keep English.
  {
    pattern: /\bPull[\s-]+Demande\w*/i,
    correct: '"Pull Request" (Git vocabulary stays English in FR)',
    rule: 'fr-half-pull-demande',
  },
  {
    pattern: /\bMerge[\s-]+Fusion\w*/i,
    correct: '"Merge" (Git vocabulary stays English in FR)',
    rule: 'fr-half-merge-fusion',
  },
  {
    pattern: /\bCode[\s-]+Review[\s-]+Processus\w*/i,
    correct: '"Code Review" (drop Processus suffix)',
    rule: 'fr-half-code-review-processus',
  },
  {
    pattern: /\bBranch[\s-]+Branche\w*/i,
    correct: '"Branch" (Git vocabulary stays English in FR)',
    rule: 'fr-half-branch-branche',
  },
  // Product-domain compounds: translate whole.
  {
    pattern: /\bKnowledge[\s-]+Base\b/i,
    correct: '"Base de connaissances" (translate the full compound)',
    rule: 'fr-half-knowledge-base',
  },
  {
    pattern: /\bHelp[\s-]+Centre\b/i,
    correct: '"Centre d\'aide"',
    rule: 'fr-half-help-centre',
  },
];

export const TERMINOLOGY_FR: LocaleTerminologyConfig = {
  halfCompounds: HALF_COMPOUNDS,
  calques: [],
};
