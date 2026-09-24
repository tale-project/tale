/**
 * German style config.
 *
 * Doctrine: `.agents/translation/locales/de/AGENTS.md`.
 *
 * Conventions:
 *   - Quotes: `„text"` (low-9 U+201E + high-9 U+201C) in prose; ASCII in JSON.
 *   - Apostrophes: ASCII `'` everywhere.
 *   - Dates: `DD.MM.YYYY` in prose; ISO `YYYY-MM-DD` in code/frontmatter.
 *   - Numbers: decimal `,`; thousands `.` or thin space.
 *   - Currency: EUR (`€`), suffix.
 *   - `ß` after long vowels / diphthongs (Straße, groß, schließen).
 *   - Em-dash spaced ` — `.
 *   - En-dash for number ranges.
 */

import type { LocaleStyleConfig } from '../types';

export const STYLE_DE: LocaleStyleConfig = {
  quotes: { kind: 'german-low9-high9', open: '„', close: '“' },
  apostrophe: { proseChar: "'", codeChar: "'" },
  numbers: { decimal: ',', thousands: '.' },
  dates: { preferred: 'DD.MM.YYYY', accept: ['DD.MM.YYYY', 'YYYY-MM-DD'] },
  currency: {
    preferred: 'EUR',
    position: 'suffix',
    acceptedSymbols: ['€', 'EUR'],
  },
  allowSharpS: true,
  emDash: 'spaced',
  enDashForRanges: true,
};
