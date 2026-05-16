import type { DriftRule } from '../lib/rules';

/**
 * Half-translated compound terms — patterns where a multi-word technical
 * term gets split across languages.
 *
 * Source:
 *   - `.agents/terminology/TERMINOLOGY_DE.md` §2 anti-pattern 7
 *   - `.agents/terminology/TERMINOLOGY_FR.md` §2 equivalent (when present)
 *   - `.claude/skills/docs/SKILL.md` anti-pattern "Half-Translated Compound"
 *
 * The rule: compound terms translate whole or stay whole, never half. Git-
 * domain vocabulary (`Pull Request`, `Code Review`, `Branch`, `Commit`,
 * `Merge`, `Rebase`) stays English in DE and FR. Product compounds
 * (`Knowledge Base` → `Wissensdatenbank` / `Base de connaissances`)
 * translate whole.
 *
 * Consumed by `43-terminology-compounds.test.ts`.
 *
 * Patterns are case-insensitive by default (use the `i` flag) — half-
 * compounds appear in body prose and in headings; both should fail.
 */

export const HALF_COMPOUNDS: readonly DriftRule[] = [
  // ── DE half-compounds (Git domain — keep English) ───────────────────────
  {
    id: 'de-half-pull-anfrage',
    pattern: /\bPull[\s-]+Anfrage\w*/i,
    target: '"Pull Request" (Git vocabulary stays English in DE)',
    locales: ['de', 'de-CH'],
  },
  {
    id: 'de-half-merge-anfrage',
    pattern: /\bMerge[\s-]+Anfrage\w*/i,
    target: '"Pull Request" (or rephrase — "Merge-Anfrage" is not a real term)',
    locales: ['de', 'de-CH'],
  },
  {
    id: 'de-half-code-review-prozess',
    pattern: /\bCode[\s-]+Review[\s-]+Prozess\w*/i,
    target: '"Code Review" (drop the German "-Prozess" suffix)',
    locales: ['de', 'de-CH'],
  },
  {
    id: 'de-half-branch-zweig',
    pattern: /\bBranch[\s-]+Zweig\w*/i,
    target: '"Branch" (Git vocabulary stays English in DE)',
    locales: ['de', 'de-CH'],
  },
  {
    id: 'de-half-commit-übergabe',
    pattern: /\bCommit[\s-]+Übergabe\w*/i,
    target: '"Commit" (Git vocabulary stays English in DE)',
    locales: ['de', 'de-CH'],
  },

  // ── DE half-compounds (product domain — translate whole) ────────────────
  {
    id: 'de-half-knowledge-datenbank',
    pattern: /\bKnowledge[\s-]+Datenbank\w*/i,
    target: '"Wissensdatenbank" (translate the full compound)',
    locales: ['de', 'de-CH'],
  },
  {
    id: 'de-half-knowledge-basis',
    pattern: /\bKnowledge[\s-]+Basis\w*/i,
    target: '"Wissensdatenbank"',
    locales: ['de', 'de-CH'],
  },
  {
    id: 'de-half-help-zentrum',
    pattern: /\bHelp[\s-]+Zentrum\w*/i,
    target: '"Hilfe-Center" (matches shipped UI)',
    locales: ['de', 'de-CH'],
  },
  {
    id: 'de-half-email-anbieter',
    pattern: /\bEmail[\s-]+Anbieter\w*/i,
    target: '"E-Mail-Anbieter" (note: `E-Mail`, not `Email`)',
    locales: ['de', 'de-CH'],
  },

  // ── FR half-compounds (Git domain — keep English) ───────────────────────
  {
    id: 'fr-half-pull-demande',
    pattern: /\bPull[\s-]+Demande\w*/i,
    target: '"Pull Request" (Git vocabulary stays English in FR)',
    locales: ['fr'],
  },
  {
    id: 'fr-half-merge-fusion',
    pattern: /\bMerge[\s-]+Fusion\w*/i,
    target: '"Merge" (Git vocabulary stays English in FR)',
    locales: ['fr'],
  },
  {
    id: 'fr-half-code-review-processus',
    pattern: /\bCode[\s-]+Review[\s-]+Processus\w*/i,
    target: '"Code Review" (drop the French "Processus" suffix)',
    locales: ['fr'],
  },
  {
    id: 'fr-half-branch-branche',
    pattern: /\bBranch[\s-]+Branche\w*/i,
    target: '"Branch" (Git vocabulary stays English in FR)',
    locales: ['fr'],
  },

  // ── FR half-compounds (product domain — translate whole) ────────────────
  {
    id: 'fr-half-knowledge-base',
    pattern: /\bKnowledge[\s-]+Base\b/i,
    target: '"Base de connaissances" (translate the full compound)',
    locales: ['fr'],
  },
  {
    id: 'fr-half-help-centre',
    pattern: /\bHelp[\s-]+Centre\b/i,
    target: '"Centre d\'aide"',
    locales: ['fr'],
  },
];
