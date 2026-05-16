import type { StrikeEntry } from '../lib/rules';

/**
 * The German strike list — words that fail review on sight in `docs/de/**`
 * and `docs/de-CH/**`.
 *
 * Source: `.agents/terminology/TERMINOLOGY_DE.md` §1 strike-on-sight table.
 *
 * Consumed by `51-voice-de.test.ts`. Boundary is `de` to handle umlauts and
 * `ß` (the regex needs to recognise `ÄÖÜß` as letters so `großzügig` doesn't
 * trip `groß`).
 *
 * Several terms are valid German nouns in other contexts — `praktisch` is a
 * fine word in a sentence about a hands-on workshop, but a softener in a
 * product page. The test catches them all; reviewers approve narrow
 * exceptions via PR comment, not via `allowIn` carve-outs.
 */

export const VOICE_STRIKE_DE: readonly StrikeEntry[] = [
  {
    id: 'de-einfach',
    term: 'einfach',
    boundary: 'de',
    replace: 'delete; the demonstration carries it',
  },
  {
    id: 'de-ganz-einfach',
    term: 'ganz einfach',
    boundary: 'de',
    replace: 'delete',
  },
  {
    id: 'de-muehelos',
    term: 'mühelos',
    boundary: 'de',
    replace: 'delete',
  },
  {
    id: 'de-bequem',
    term: 'bequem',
    boundary: 'de',
    replace: 'delete or describe what makes it convenient',
  },
  {
    id: 'de-praktisch',
    term: 'praktisch',
    boundary: 'de',
    replace: 'delete',
  },
  {
    id: 'de-leistungsstark',
    term: 'leistungsstark',
    boundary: 'de',
    replace: 'delete or replace with a concrete capability',
  },
  {
    id: 'de-intuitiv',
    term: 'intuitiv',
    boundary: 'de',
    replace: 'delete; the screenshot shows it',
  },
  {
    id: 'de-nahtlos',
    term: 'nahtlos',
    boundary: 'de',
    replace: 'delete; describe the missing step that makes it seamless',
  },
  {
    id: 'de-bitte',
    term: 'bitte',
    boundary: 'de',
    replace: 'delete; imperative does the work',
  },
  {
    id: 'de-entdecke',
    term: 'Entdecke',
    boundary: 'de',
    caseInsensitive: false,
    replace: 'replace with "Lies", "Öffne", "Sieh dir … an"',
  },
  {
    id: 'de-entdecken',
    term: 'Entdecken',
    boundary: 'de',
    caseInsensitive: false,
    replace: 'replace with "Lies", "Öffne", "Sieh dir … an"',
  },
  {
    id: 'de-erlebe',
    term: 'Erlebe',
    boundary: 'de',
    caseInsensitive: false,
    replace: 'delete or replace with the concrete action',
  },
];
