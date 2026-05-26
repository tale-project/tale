/**
 * `voice-drift` — per-locale drift patterns (DE bureaucracy + future locales).
 *
 * Value-shape-aware: rules with `valueShape: 'whole-value'` only fire when
 * the regex matches the entire fragment text (used for DE `Wird X…` so
 * legit declarative passive doesn't trip the pattern).
 *
 * Default mode is `report` — the 35 known DE `Wird` violations surface in
 * the end-of-run summary without failing the build. Flip to `enforce`
 * after cleanup.
 */

import type { DriftRule } from '../locales/types';
import type { Finding } from './types';
import { createCheck } from './types';

export const voiceDrift = createCheck({
  id: 'voice-drift',
  scope: 'both',
  defaultMode: 'report',
  localeFilter: (locale) => locale.voice.drift.length > 0,
  run(ctx) {
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      if (locale.voice.drift.length === 0) continue;
      for (const fragment of ctx.scanner.fragments({ locale: locale.id })) {
        if (fragment.disabled?.has('voice-drift')) continue;
        for (const rule of locale.voice.drift) {
          if (!rule.applyTo.includes(fragment.surface)) continue;
          if (rule.valueShape === 'whole-value') {
            if (!matchesWholeValue(rule, fragment.text)) continue;
            findings.push(makeFinding(rule, fragment, 0, fragment.text.trim()));
            continue;
          }
          rule.pattern.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = rule.pattern.exec(fragment.text)) !== null) {
            findings.push(makeFinding(rule, fragment, m.index, m[0]));
            if (!rule.pattern.global) break;
          }
        }
      }
    }
    return findings;

    function makeFinding(
      rule: DriftRule,
      fragment: {
        pos: { file: string; line: number; column: number };
        key: string | null;
        locale: string;
      },
      offset: number,
      matched: string,
    ): Finding {
      const surface =
        matched.length > 80 ? `${matched.slice(0, 77)}...` : matched;
      const localeConfig = ctx.locales.find((l) => l.id === fragment.locale);
      return {
        file: fragment.pos.file,
        line: fragment.pos.line,
        column: fragment.pos.column + offset,
        key: fragment.key ?? undefined,
        locale: fragment.locale,
        rule: rule.rule,
        detail: `"${surface}"`,
        suggest: rule.suggest,
        doctrine: localeConfig?.doctrine,
      };
    }
  },
});

function matchesWholeValue(rule: DriftRule, text: string): boolean {
  const trimmed = text.trim();
  rule.pattern.lastIndex = 0;
  const m = rule.pattern.exec(trimmed);
  if (!m) return false;
  return m[0].length === trimmed.length;
}
