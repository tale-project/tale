/**
 * `style-percent-nbsp` — DE / DE-CH / FR convention: NBSP between a number
 * and `%`. Catches `5%` → `5 %`.
 */

import type { Finding } from './types';
import { createCheck } from './types';

// Regular space (or no space) + percent, after a digit.
const PERCENT = /(\d)(\s| )?%/g;

const LOCALES_REQUIRING_NBSP_PERCENT = new Set(['de', 'de-CH', 'fr']);

export const stylePercentNbsp = createCheck({
  id: 'style-percent-nbsp',
  scope: 'both',
  defaultMode: 'report',
  localeFilter: (locale) => LOCALES_REQUIRING_NBSP_PERCENT.has(locale.id),
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      if (!LOCALES_REQUIRING_NBSP_PERCENT.has(locale.id)) continue;
      for (const fragment of ctx.scanner.fragments({ locale: locale.id })) {
        if (fragment.disabled?.has('style-percent-nbsp')) continue;
        PERCENT.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = PERCENT.exec(fragment.text)) !== null) {
          const sep = m[2] ?? '';
          // Only flag if separator is missing OR is a regular space (not NBSP).
          if (sep === '' || sep === ' ') {
            findings.push({
              file: fragment.pos.file,
              line: fragment.pos.line,
              column: fragment.pos.column + m.index,
              key: fragment.key ?? undefined,
              locale: fragment.locale,
              rule: 'percent-missing-nbsp',
              detail:
                sep === ''
                  ? `"${m[1]}%" without space`
                  : `"${m[1]} %" with regular space`,
              suggest: `use NBSP: "${m[1]} %"`,
              doctrine: locale.doctrine,
            });
          }
        }
      }
    }
    return findings;
  },
});
