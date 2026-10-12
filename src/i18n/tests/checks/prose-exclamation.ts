/**
 * `prose-exclamation` — no `!` in EN prose outside allowed contexts.
 *
 * Allowed: `!=`, `!important`, `[!NOTE]` / `[!WARNING]` callouts, `![alt]`
 * image syntax. Locale data: `locales/en/style.ts:allowedBangContexts`.
 */

import type { Finding } from './types';
import { createCheck } from './types';

export const proseExclamation = createCheck({
  id: 'prose-exclamation',
  scope: 'markdown',
  defaultMode: 'enforce',
  localeFilter: (locale) => !!locale.style.allowedBangContexts,
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      const allowed = locale.style.allowedBangContexts;
      if (!allowed) continue;
      for (const fragment of ctx.scanner.fragments({
        locale: locale.id,
        surface: 'markdown',
      })) {
        if (fragment.disabled?.has('prose-exclamation')) continue;
        let idx = -1;
        while ((idx = fragment.text.indexOf('!', idx + 1)) !== -1) {
          // Check if this `!` is inside an allowed context. Each allowed regex
          // is tested against the full line; if any matches with a span that
          // covers idx, the `!` is allowed.
          if (isInAllowedContext(fragment.text, idx, allowed)) continue;
          findings.push({
            file: fragment.pos.file,
            line: fragment.pos.line,
            column: fragment.pos.column + idx,
            locale: fragment.locale,
            rule: `${locale.id}-prose-exclamation`,
            detail: 'exclamation mark in prose',
            suggest:
              'delete; the page demonstrates the point, the prose does not exclaim it',
            doctrine: locale.doctrine,
          });
        }
      }
    }
    return findings;
  },
});

function isInAllowedContext(
  line: string,
  idx: number,
  allowed: ReadonlyArray<RegExp>,
): boolean {
  for (const re of allowed) {
    const globalRe = re.global ? re : new RegExp(re.source, re.flags + 'g');
    globalRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = globalRe.exec(line)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (idx >= start && idx < end) return true;
    }
  }
  return false;
}
