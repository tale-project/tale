/**
 * `style-apostrophes` — per-locale apostrophe convention.
 *
 *   - EN / DE: ASCII `'` everywhere.
 *   - FR: typographic `’` in markdown prose; ASCII in JSON / code.
 *
 * Markdown-only — JSON values always use ASCII regardless.
 */

import type { Finding } from './types';
import { createCheck } from './types';

const CURLY_APOSTROPHE = /’/g;
const ASCII_APOSTROPHE = /'/g;

export const styleApostrophes = createCheck({
  id: 'style-apostrophes',
  scope: 'markdown',
  defaultMode: 'report',
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      for (const fragment of ctx.scanner.fragments({
        locale: locale.id,
        surface: 'markdown',
      })) {
        if (fragment.disabled?.has('style-apostrophes')) continue;
        if (locale.style.apostrophe.proseChar === "'") {
          // EN / DE: reject typographic apostrophe in prose.
          CURLY_APOSTROPHE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = CURLY_APOSTROPHE.exec(fragment.text)) !== null) {
            findings.push({
              file: fragment.pos.file,
              line: fragment.pos.line,
              column: fragment.pos.column + m.index,
              locale: fragment.locale,
              rule: `${locale.id}-apostrophe-curly`,
              detail: 'typographic apostrophe in prose',
              suggest: "use ASCII '",
              doctrine: locale.doctrine,
            });
          }
        } else {
          // FR prose: reject ASCII apostrophe between letters (l'équipe etc.).
          ASCII_APOSTROPHE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = ASCII_APOSTROPHE.exec(fragment.text)) !== null) {
            // Allow ASCII at sentence boundaries (rare); require letter on both sides.
            const before = fragment.text[m.index - 1];
            const after = fragment.text[m.index + 1];
            if (
              before &&
              after &&
              /[a-zA-ZÀ-ÖØ-öø-ÿ]/.test(before) &&
              /[a-zA-ZÀ-ÖØ-öø-ÿ]/.test(after)
            ) {
              findings.push({
                file: fragment.pos.file,
                line: fragment.pos.line,
                column: fragment.pos.column + m.index,
                locale: fragment.locale,
                rule: 'fr-apostrophe-ascii',
                detail: 'ASCII apostrophe in FR prose',
                suggest: 'use typographic ’',
                doctrine: locale.doctrine,
              });
            }
          }
        }
      }
    }
    return findings;
  },
});
