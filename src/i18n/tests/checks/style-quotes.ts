/**
 * `style-quotes` — per-locale quote convention.
 *
 *   - EN: ASCII straight `"…"` everywhere.
 *   - DE: prose `„…"` (low-9 + high-9). JSON values use ASCII (syntax).
 *   - DE-CH: prose `«…»` (Swiss) OR `„…"` accepted.
 *   - FR: prose `« text »` with NBSP inside.
 *
 * Default mode is `report` — corpus-wide quote rewrites are a follow-up.
 */

import type { Finding } from './types';
import { createCheck } from './types';

const CURLY_QUOTE = /[“”„«»]/g;
const ASCII_QUOTE_PAIR = /"([^"\n]+)"/g;

export const styleQuotes = createCheck({
  id: 'style-quotes',
  scope: 'both',
  defaultMode: 'report',
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      for (const fragment of ctx.scanner.fragments({ locale: locale.id })) {
        if (fragment.disabled?.has('style-quotes')) continue;
        const kind = locale.style.quotes.kind;
        if (kind === 'ascii') {
          // EN: reject any curly/guillemet quote.
          CURLY_QUOTE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = CURLY_QUOTE.exec(fragment.text)) !== null) {
            findings.push({
              file: fragment.pos.file,
              line: fragment.pos.line,
              column: fragment.pos.column + m.index,
              key: fragment.key ?? undefined,
              locale: fragment.locale,
              rule: 'quotes-non-ascii-in-en',
              detail: `non-ASCII quote "${m[0]}" in EN`,
              suggest: 'use ASCII straight quotes "..."',
              doctrine: locale.doctrine,
            });
          }
        } else if (fragment.surface === 'markdown') {
          // DE/FR/de-CH prose: reject ASCII pair "..." where it looks like a quote.
          ASCII_QUOTE_PAIR.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = ASCII_QUOTE_PAIR.exec(fragment.text)) !== null) {
            findings.push({
              file: fragment.pos.file,
              line: fragment.pos.line,
              column: fragment.pos.column + m.index,
              key: fragment.key ?? undefined,
              locale: fragment.locale,
              rule: 'quotes-ascii-in-prose',
              detail: `ASCII quotes around "${m[1]}"`,
              suggest: `use ${locale.style.quotes.open}${m[1]}${locale.style.quotes.close}`,
              doctrine: locale.doctrine,
            });
          }
        }
      }
    }
    return findings;
  },
});
