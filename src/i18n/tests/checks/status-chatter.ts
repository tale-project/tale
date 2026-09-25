/**
 * `status-chatter` — per-locale prefix denylist (`Updated:`, `Coming soon:`,
 * locale equivalents). Locale data: `locales/<locale>/patterns.ts:statusChatter`.
 */

import type { Finding } from './types';
import { createCheck } from './types';

export const statusChatter = createCheck({
  id: 'status-chatter',
  scope: 'markdown',
  defaultMode: 'enforce',
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      const patterns = locale.patterns.statusChatter;
      if (patterns.length === 0) continue;
      for (const fragment of ctx.scanner.fragments({
        locale: locale.id,
        surface: 'markdown',
      })) {
        if (fragment.disabled?.has('status-chatter')) continue;
        for (const pattern of patterns) {
          pattern.lastIndex = 0;
          const m = pattern.exec(fragment.text);
          if (m) {
            findings.push({
              file: fragment.pos.file,
              line: fragment.pos.line,
              column: fragment.pos.column + m.index,
              locale: fragment.locale,
              rule: 'status-chatter',
              detail: `chatter opener "${m[0].trim()}"`,
              suggest:
                'release notes carry version history; git carries the rest',
              doctrine: locale.doctrine,
            });
          }
        }
      }
    }
    return findings;
  },
});
