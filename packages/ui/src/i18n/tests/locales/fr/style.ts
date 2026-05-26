/**
 * French style config.
 *
 * Doctrine: `.agents/translation/locales/fr/AGENTS.md`.
 *
 * Conventions:
 *   - Quotes: `« text »` (guillemets) with NBSP inside in prose; ASCII in JSON.
 *   - Apostrophe: typographic `’` in prose, ASCII `'` in code/JSON.
 *   - Dates: `DD/MM/YYYY` in prose; ISO in code.
 *   - Numbers: decimal `,`; thousands NNBSP (U+202F).
 *   - Currency: EUR (`€`), suffix.
 *   - NBSP before `:;!?%` in prose (French convention).
 *   - Em-dash spaced ` — `.
 *   - En-dash for number ranges.
 */

import type { LocaleStyleConfig } from '../types';

export const STYLE_FR: LocaleStyleConfig = {
  quotes: { kind: 'french-guillemet', open: '«', close: '»', nbspInside: true },
  apostrophe: { proseChar: '’', codeChar: "'" },
  numbers: { decimal: ',', thousands: ' ' }, // NNBSP
  dates: { preferred: 'DD/MM/YYYY', accept: ['DD/MM/YYYY', 'YYYY-MM-DD'] },
  currency: {
    preferred: 'EUR',
    position: 'suffix',
    acceptedSymbols: ['€', 'EUR'],
  },
  allowSharpS: false,
  emDash: 'spaced',
  enDashForRanges: true,
  // French requires NBSP before `:;!?%`. The check looks for a regular
  // space followed by one of these characters.
  nbspBeforePunctuation: /(?<! ) (?=[:;!?%»])/g,
};
