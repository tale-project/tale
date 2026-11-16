/**
 * German patterns config — formal-pronoun denylist + status chatter.
 *
 * Sentence-initial `Sie` is heuristically allowed because it doubles as
 * the capitalised third-person feminine/plural pronoun. The check
 * (`pronouns-formal`) applies the carve-out via
 * `isCapitalisedSentenceStart` from `internals/sentence.ts`.
 */

import type { LocalePatternsConfig } from '../types';

export const PATTERNS_DE: LocalePatternsConfig = {
  formalPronouns: [
    /\bSie\b/g, // formal subject — sentence-initial allowed by check
    /\bIhnen\b/g, // formal dative
    /\bIhre\b/g, // formal possessive (fem/pl nom/acc)
    /\bIhrer\b/g, // formal possessive (gen/dat fem)
    /\bIhres\b/g, // formal possessive (gen masc/neut)
    /\bIhrem\b/g, // formal possessive (dat masc/neut)
    /\bIhren\b/g, // formal possessive (acc masc, dat pl)
  ],
  statusChatter: [
    /^\s*Aktualisiert:\s*/i,
    /^\s*Bald\s+verfügbar:?\s*/i,
    /^\s*Beachte\s+bitte\b/i,
  ],
  maxCompoundLength: 28, // heuristic: longer single-word compounds surface for review
};
