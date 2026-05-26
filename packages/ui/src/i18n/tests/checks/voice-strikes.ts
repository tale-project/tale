/**
 * `voice-strikes` — per-locale marketing-softener denylist.
 *
 * Locale data: `locales/<locale>/voice.ts:strikes`.
 */

import type { Finding } from './types';
import { createCheck } from './types';

export const voiceStrikes = createCheck({
  id: 'voice-strikes',
  scope: 'both',
  defaultMode: 'enforce',
  localeFilter: (locale) => locale.voice.strikes.length > 0,
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      if (locale.voice.strikes.length === 0) continue;
      for (const fragment of ctx.scanner.fragments({ locale: locale.id })) {
        if (fragment.disabled?.has('voice-strikes')) continue;
        for (const strike of locale.voice.strikes) {
          if (!strike.applyTo.includes(fragment.surface)) continue;
          strike.pattern.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = strike.pattern.exec(fragment.text)) !== null) {
            findings.push({
              file: fragment.pos.file,
              line: fragment.pos.line,
              column: fragment.pos.column + m.index,
              key: fragment.key ?? undefined,
              locale: fragment.locale,
              rule: strike.rule,
              detail: `marketing softener "${m[0]}" — the page demonstrates quality, the prose does not assert it`,
              suggest: strike.suggest,
              doctrine: locale.doctrine,
            });
            if (!strike.pattern.global) break;
          }
        }
      }
    }
    return findings;
  },
});
