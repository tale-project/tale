/**
 * `style-dates` — prose dates match the locale's preferred format.
 *
 * Detects `D-M-Y` shaped sequences in prose. ISO `YYYY-MM-DD` is accepted
 * by every locale (code/frontmatter form). Wrong-format flags only when
 * the date is recognisably regional (e.g. `04/19/2026` in DE prose).
 */

import type { Finding } from './types';
import { createCheck } from './types';

// Slash-separated date candidate that isn't ISO.
const SLASH_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
// Dot-separated DE-style.
const DOT_DATE = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g;

export const styleDates = createCheck({
  id: 'style-dates',
  scope: 'markdown',
  defaultMode: 'report',
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      const preferred = locale.style.dates.preferred;
      for (const fragment of ctx.scanner.fragments({
        locale: locale.id,
        surface: 'markdown',
      })) {
        if (fragment.disabled?.has('style-dates')) continue;
        if (preferred === 'DD.MM.YYYY') {
          // Reject slash-dates.
          SLASH_DATE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = SLASH_DATE.exec(fragment.text)) !== null) {
            findings.push({
              file: fragment.pos.file,
              line: fragment.pos.line,
              column: fragment.pos.column + m.index,
              locale: fragment.locale,
              rule: `${locale.id}-date-format`,
              detail: `slash-separated date "${m[0]}" in ${locale.id} prose`,
              suggest: 'use DD.MM.YYYY format',
              doctrine: locale.doctrine,
            });
          }
        } else if (preferred === 'DD/MM/YYYY') {
          // FR: reject dot-dates.
          DOT_DATE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = DOT_DATE.exec(fragment.text)) !== null) {
            findings.push({
              file: fragment.pos.file,
              line: fragment.pos.line,
              column: fragment.pos.column + m.index,
              locale: fragment.locale,
              rule: `${locale.id}-date-format`,
              detail: `dot-separated date "${m[0]}" in ${locale.id} prose`,
              suggest: 'use DD/MM/YYYY format',
              doctrine: locale.doctrine,
            });
          }
        }
      }
    }
    return findings;
  },
});
