/**
 * `style-ss` — locales with `allowSharpS: false` (today: de-CH) must not
 * contain the German sharp-s `ß`. Every `ß` is `ss` in Swiss German.
 */

import type { Finding } from './types';
import { createCheck } from './types';

export const styleSs = createCheck({
  id: 'style-ss',
  scope: 'both',
  defaultMode: 'enforce',
  localeFilter: (locale) => !locale.style.allowSharpS && locale.id !== 'en',
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      if (locale.style.allowSharpS) continue;
      if (locale.id === 'en') continue;
      for (const fragment of ctx.scanner.fragments({ locale: locale.id })) {
        if (fragment.disabled?.has('style-ss')) continue;
        let idx = -1;
        while ((idx = fragment.text.indexOf('ß', idx + 1)) !== -1) {
          findings.push({
            file: fragment.pos.file,
            line: fragment.pos.line,
            column: fragment.pos.column + idx,
            key: fragment.key ?? undefined,
            locale: fragment.locale,
            rule: 'sharp-s-not-allowed',
            detail: `sharp-s "ß" in ${locale.id}`,
            suggest: 'replace with "ss" — Swiss German uses no sharp-s',
            doctrine: locale.doctrine,
          });
        }
      }
    }
    return findings;
  },
});
