/**
 * `style-nbsp` — locales that require NBSP before specific punctuation.
 *
 * Today: French requires NBSP before `:;!?%»` and after `«`. Locale data:
 * `locales/<locale>/style.ts:nbspBeforePunctuation`.
 */

import type { Finding } from './types';
import { createCheck } from './types';

export const styleNbsp = createCheck({
  id: 'style-nbsp',
  scope: 'both',
  defaultMode: 'report',
  localeFilter: (locale) => !!locale.style.nbspBeforePunctuation,
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      const re = locale.style.nbspBeforePunctuation;
      if (!re) continue;
      for (const fragment of ctx.scanner.fragments({ locale: locale.id })) {
        if (fragment.disabled?.has('style-nbsp')) continue;
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(fragment.text)) !== null) {
          findings.push({
            file: fragment.pos.file,
            line: fragment.pos.line,
            column: fragment.pos.column + m.index,
            key: fragment.key ?? undefined,
            locale: fragment.locale,
            rule: 'nbsp-missing',
            detail: 'regular space before French punctuation',
            suggest: 'use NBSP (\\u00A0) before "; : ! ? %"',
            doctrine: locale.doctrine,
          });
          if (!re.global) break;
        }
      }
    }
    return findings;
  },
});
