/**
 * `terminology-half-compound` — per-locale half-translated compound denylist.
 *
 * Locale data: `locales/<locale>/terminology.ts:halfCompounds`.
 */

import type { Finding } from './types';
import { createCheck } from './types';

export const terminologyHalfCompound = createCheck({
  id: 'terminology-half-compound',
  scope: 'both',
  defaultMode: 'enforce',
  localeFilter: (locale) => locale.terminology.halfCompounds.length > 0,
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      if (locale.terminology.halfCompounds.length === 0) continue;
      for (const fragment of ctx.scanner.fragments({ locale: locale.id })) {
        if (fragment.disabled?.has('terminology-half-compound')) continue;
        for (const rule of locale.terminology.halfCompounds) {
          rule.pattern.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = rule.pattern.exec(fragment.text)) !== null) {
            findings.push({
              file: fragment.pos.file,
              line: fragment.pos.line,
              column: fragment.pos.column + m.index,
              key: fragment.key ?? undefined,
              locale: fragment.locale,
              rule: rule.rule,
              detail: `half-translated compound "${m[0]}"`,
              suggest: `use ${rule.correct}`,
              doctrine: locale.doctrine,
            });
            if (!rule.pattern.global) break;
          }
        }
      }
    }
    return findings;
  },
});
