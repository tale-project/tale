/**
 * `style-en-dash` — number ranges should use en-dash (`2010–2020`) not
 * hyphen (`2010-2020`) or em-dash.
 *
 * Edge cases excluded: semver (`v1.2.3-rc`), ISO dates (`2026-04-19`),
 * hex codes — handled by requiring a 4-digit year on both sides.
 */

import type { Finding } from './types';
import { createCheck } from './types';

const HYPHEN_RANGE = /\b(\d{4})-(\d{4})\b/g;

export const styleEnDash = createCheck({
  id: 'style-en-dash',
  scope: 'markdown',
  defaultMode: 'report',
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      if (!locale.style.enDashForRanges) continue;
      for (const fragment of ctx.scanner.fragments({
        locale: locale.id,
        surface: 'markdown',
      })) {
        if (fragment.disabled?.has('style-en-dash')) continue;
        HYPHEN_RANGE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = HYPHEN_RANGE.exec(fragment.text)) !== null) {
          findings.push({
            file: fragment.pos.file,
            line: fragment.pos.line,
            column: fragment.pos.column + m.index,
            locale: fragment.locale,
            rule: 'en-dash-for-range',
            detail: `hyphen in number range "${m[0]}"`,
            suggest: `use en-dash: ${m[1]}–${m[2]}`,
            doctrine: locale.doctrine,
          });
        }
      }
    }
    return findings;
  },
});
