/**
 * Swiss German style config.
 *
 * Overlay on top of DE. The check framework resolves DE-CH first via the
 * `fallback` chain; overrides below replace the DE defaults.
 *
 * Conventions:
 *   - No `ß` anywhere — every sharp-s is `ss` (Strasse, gross, schliessen).
 *   - Quotes: `«…»` (Swiss guillemet) — no NBSP requirement.
 *   - Apostrophes: ASCII everywhere.
 *   - Numbers: decimal `.`; thousands `'` (apostrophe: `1'000`).
 *   - Currency: CHF, prefix (CHF 100).
 *   - Em-dash + en-dash policy: same as DE.
 */

import { STYLE_DE } from '../de/style';
import type { LocaleStyleConfig } from '../types';

export const STYLE_DE_CH: LocaleStyleConfig = {
  ...STYLE_DE,
  quotes: { kind: 'swiss-guillemet', open: '«', close: '»' },
  numbers: { decimal: '.', thousands: "'" },
  currency: { preferred: 'CHF', position: 'prefix', acceptedSymbols: ['CHF'] },
  allowSharpS: false,
};
