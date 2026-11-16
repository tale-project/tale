/**
 * `pronouns-formal` — formal-pronoun denylist per locale.
 *
 * Locale data: `locales/<locale>/patterns.ts:formalPronouns`.
 * Carve-out: sentence-initial `Sie` in DE/de-CH (third-person feminine
 * ambiguity) is allowed.
 */

import { isCapitalisedSentenceStart } from '../internals/sentence';
import type { Finding } from './types';
import { createCheck } from './types';

export const pronounsFormal = createCheck({
  id: 'pronouns-formal',
  scope: 'both',
  defaultMode: 'enforce',
  localeFilter: (locale) => locale.patterns.formalPronouns.length > 0,
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      if (locale.patterns.formalPronouns.length === 0) continue;
      const isDe = locale.id === 'de' || locale.id === 'de-CH';
      for (const fragment of ctx.scanner.fragments({ locale: locale.id })) {
        if (fragment.disabled?.has('pronouns-formal')) continue;
        for (const pattern of locale.patterns.formalPronouns) {
          pattern.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = pattern.exec(fragment.text)) !== null) {
            // DE carve-out: capitalised `Sie` at sentence start is the
            // third-person feminine/plural and is allowed.
            if (
              isDe &&
              m[0] === 'Sie' &&
              isCapitalisedSentenceStart(fragment.text, m.index)
            )
              continue;
            findings.push({
              file: fragment.pos.file,
              line: fragment.pos.line,
              column: fragment.pos.column + m.index,
              key: fragment.key ?? undefined,
              locale: fragment.locale,
              rule: `${locale.id}-pronoun-formal`,
              detail: `formal pronoun "${m[0]}" — rewrite to the informal form`,
              suggest: isDe
                ? 'use "du" / "dein" / "dir"'
                : 'use "tu" / "ton" / "tes"',
              doctrine: locale.doctrine,
            });
            if (!pattern.global) break;
          }
        }
      }
    }
    return findings;
  },
});
