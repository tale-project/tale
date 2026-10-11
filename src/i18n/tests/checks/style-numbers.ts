/**
 * `style-numbers` — locale-specific decimal and thousands separators.
 *
 * Heuristic: a number like `1,000.50` reads as EN. `1.000,50` reads as
 * DE / FR. The check flags numbers whose separator pair contradicts the
 * locale's convention. Excludes ISO dates, semver, hex codes via regex.
 */

import type { Finding } from './types';
import { createCheck } from './types';

// A number candidate is a sequence of digits with one or two separators.
const NUM = /\b\d{1,3}([.,'  \s])\d{3}([.,])\d+\b/g;

export const styleNumbers = createCheck({
  id: 'style-numbers',
  scope: 'both',
  defaultMode: 'report',
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      const wantDecimal = locale.style.numbers.decimal;
      const wantThousands = locale.style.numbers.thousands;
      for (const fragment of ctx.scanner.fragments({ locale: locale.id })) {
        if (fragment.disabled?.has('style-numbers')) continue;
        NUM.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = NUM.exec(fragment.text)) !== null) {
          const thousands = m[1];
          const decimal = m[2];
          if (decimal !== wantDecimal || thousands !== wantThousands) {
            findings.push({
              file: fragment.pos.file,
              line: fragment.pos.line,
              column: fragment.pos.column + m.index,
              key: fragment.key ?? undefined,
              locale: fragment.locale,
              rule: 'number-separator-mismatch',
              detail: `number "${m[0]}" has separators "${thousands}"/"${decimal}"`,
              suggest: `${locale.id} expects thousands "${wantThousands}" and decimal "${wantDecimal}"`,
              doctrine: locale.doctrine,
            });
          }
        }
      }
    }
    return findings;
  },
});
