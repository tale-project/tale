/**
 * German terminology config — half-translated compounds + calques.
 *
 * Migrated from `services/docs/tests/data/half-compounds.ts` (DE entries).
 */

import type { HalfCompoundRule, LocaleTerminologyConfig } from '../types';

const HALF_COMPOUNDS: ReadonlyArray<HalfCompoundRule> = [
  // Git-domain compounds: keep English.
  {
    pattern: /\bPull[\s-]+Anfrage\w*/i,
    correct: '"Pull Request" (Git vocabulary stays English in DE)',
    rule: 'de-half-pull-anfrage',
  },
  {
    pattern: /\bMerge[\s-]+Anfrage\w*/i,
    correct: '"Pull Request" (the Git term)',
    rule: 'de-half-merge-anfrage',
  },
  {
    pattern: /\bCode[\s-]+Review[\s-]+Prozess\w*/i,
    correct: '"Code Review" (drop -Prozess)',
    rule: 'de-half-code-review-prozess',
  },
  {
    pattern: /\bBranch[\s-]+Zweig\w*/i,
    correct: '"Branch" (Git vocabulary stays English in DE)',
    rule: 'de-half-branch-zweig',
  },
  {
    pattern: /\bCommit[\s-]+Übergabe\w*/i,
    correct: '"Commit" (Git vocabulary stays English in DE)',
    rule: 'de-half-commit-uebergabe',
  },
  // Product-domain compounds: translate whole.
  {
    pattern: /\bKnowledge[\s-]+Datenbank\w*/i,
    correct: '"Wissensdatenbank" (translate the full compound)',
    rule: 'de-half-knowledge-datenbank',
  },
  {
    pattern: /\bKnowledge[\s-]+Basis\w*/i,
    correct: '"Wissensdatenbank"',
    rule: 'de-half-knowledge-basis',
  },
  {
    pattern: /\bHelp[\s-]+Zentrum\w*/i,
    correct: '"Hilfe-Center" (matches shipped UI)',
    rule: 'de-half-help-zentrum',
  },
  {
    pattern: /\bEmail[\s-]+Anbieter\w*/i,
    correct: '"E-Mail-Anbieter" (E-Mail with hyphen)',
    rule: 'de-half-email-anbieter',
  },
];

export const TERMINOLOGY_DE: LocaleTerminologyConfig = {
  halfCompounds: HALF_COMPOUNDS,
  calques: [
    {
      word: 'Vertrauenshaltung',
      target: 'name the actual certifications (ISO 27001, SOC 2)',
    },
    { word: 'Nutzerreise', target: 'use "Ablauf" or "Nutzerablauf"' },
    { word: 'Operationsfläche', target: 'use "Oberfläche"' },
  ],
};
