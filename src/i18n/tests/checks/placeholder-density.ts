/**
 * `placeholder-density` — heuristic. Flags JSON values with more than N
 * placeholders (UX smell: a message that needs 5+ runtime substitutions
 * is usually trying to do too much). N defaults to 4.
 */

import { lexIcu } from '../scanner/icu-lexer';
import type { Finding } from './types';
import { createCheck } from './types';

const MAX_PLACEHOLDERS = 4;

export const placeholderDensity = createCheck({
  id: 'placeholder-density',
  scope: 'json',
  defaultMode: 'report',
  run(ctx) {
    const findings: Finding[] = [];
    for (const fragment of ctx.scanner.fragments({ surface: 'json' })) {
      if (fragment.disabled?.has('placeholder-density')) continue;
      const shape = lexIcu(fragment.text);
      if (shape.placeholders.size <= MAX_PLACEHOLDERS) continue;
      findings.push({
        file: fragment.pos.file,
        line: fragment.pos.line,
        key: fragment.key ?? undefined,
        locale: fragment.locale,
        rule: 'placeholder-density',
        detail: `value has ${shape.placeholders.size} placeholders (limit ${MAX_PLACEHOLDERS})`,
        suggest: 'consider splitting into smaller messages',
      });
    }
    return findings;
  },
});
