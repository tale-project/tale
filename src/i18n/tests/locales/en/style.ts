/**
 * English style config.
 *
 * Doctrine: `.agents/translation/locales/en/AGENTS.md` (Phase 4).
 *
 * Conventions:
 *   - Quotes: ASCII straight `"…"` everywhere.
 *   - Apostrophes: ASCII `'` everywhere.
 *   - Dates: ISO `YYYY-MM-DD` in frontmatter, "Month D, YYYY" in prose.
 *   - Numbers: decimal `.`, thousands `,`.
 *   - Currency: USD as default, `$` prefix.
 *   - Em-dash: unspaced `a—b`.
 *   - En-dash for number ranges.
 *   - No `!` in prose (allowed contexts: `!=`, `!important`, callouts, image syntax).
 */

import type { LocaleStyleConfig } from '../types';

export const STYLE_EN: LocaleStyleConfig = {
  quotes: { kind: 'ascii', open: '"', close: '"' },
  apostrophe: { proseChar: "'", codeChar: "'" },
  numbers: { decimal: '.', thousands: ',' },
  dates: { preferred: 'YYYY-MM-DD', accept: ['YYYY-MM-DD', 'Month D, YYYY'] },
  currency: {
    preferred: 'USD',
    position: 'prefix',
    acceptedSymbols: ['$', 'USD'],
  },
  allowSharpS: false,
  emDash: 'unspaced',
  enDashForRanges: true,
  allowedBangContexts: [
    /!=/, // != as in 1 != 2
    /!important/i, // CSS-style !important
    /\[![A-Z]+\]/, // [!NOTE], [!WARNING] callouts
    /!\[/, // ![alt] image syntax
  ],
};
