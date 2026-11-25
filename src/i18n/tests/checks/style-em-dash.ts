/**
 * `style-em-dash` — per-locale em-dash policy.
 *
 *   - EN: unspaced `a—b`.
 *   - DE / FR / de-CH: spaced ` — `.
 *
 * Markdown only — em-dashes in JSON values are rare and not stylistically
 * meaningful.
 */

import type { Finding } from './types';
import { createCheck } from './types';

const UNSPACED = /[^\s]—[^\s]/g;
const SPACED = / — /g;

export const styleEmDash = createCheck({
  id: 'style-em-dash',
  scope: 'markdown',
  defaultMode: 'report',
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      const want = locale.style.emDash;
      for (const fragment of ctx.scanner.fragments({
        locale: locale.id,
        surface: 'markdown',
      })) {
        if (fragment.disabled?.has('style-em-dash')) continue;
        const target = want === 'spaced' ? UNSPACED : SPACED;
        target.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = target.exec(fragment.text)) !== null) {
          findings.push({
            file: fragment.pos.file,
            line: fragment.pos.line,
            column: fragment.pos.column + m.index,
            locale: fragment.locale,
            rule: `${locale.id}-em-dash-${want === 'spaced' ? 'unspaced' : 'spaced'}`,
            detail:
              want === 'spaced'
                ? `em-dash without surrounding spaces in ${locale.id}`
                : `em-dash with surrounding spaces in ${locale.id}`,
            suggest:
              want === 'spaced'
                ? 'add a space on each side: " — "'
                : 'remove the surrounding spaces: "a—b"',
            doctrine: locale.doctrine,
          });
        }
      }
    }
    return findings;
  },
});
