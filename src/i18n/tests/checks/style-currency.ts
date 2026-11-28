/**
 * `style-currency` — prose currency symbols match the locale's preference.
 *
 *   - de-CH: CHF (rejects `€` and `$`).
 *   - DE / FR: EUR (rejects `$` and `CHF`).
 *   - EN: USD (`$`); accepts `€` only inside explicitly multi-region docs.
 *
 * Per-page opt-out via frontmatter `noCurrencyCheck: true`.
 */

import type { Finding } from './types';
import { createCheck } from './types';

const SYMBOL_RE = /(?:\$|€|£|CHF|USD|EUR|GBP)/g;

export const styleCurrency = createCheck({
  id: 'style-currency',
  scope: 'markdown',
  defaultMode: 'report',
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      const accepted = new Set(locale.style.currency.acceptedSymbols);
      for (const fragment of ctx.scanner.fragments({
        locale: locale.id,
        surface: 'markdown',
      })) {
        if (fragment.disabled?.has('style-currency')) continue;
        SYMBOL_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = SYMBOL_RE.exec(fragment.text)) !== null) {
          if (accepted.has(m[0])) continue;
          findings.push({
            file: fragment.pos.file,
            line: fragment.pos.line,
            column: fragment.pos.column + m.index,
            locale: fragment.locale,
            rule: `${locale.id}-currency-mismatch`,
            detail: `currency "${m[0]}" outside locale set`,
            suggest: `use ${locale.style.currency.preferred} (accepts: ${[...accepted].join(', ')})`,
            doctrine: locale.doctrine,
          });
        }
      }
    }
    return findings;
  },
});
