/**
 * `icu-brace-balance` — every message value must have balanced `{`/`}`
 * braces (after ICU `'`-quoting is stripped). An unbalanced brace makes the
 * whole value unparseable as ICU, so plurals/placeholders render as raw
 * source text. Runs for every locale including en — a mechanical mangle
 * (e.g. a global `}}` → `}` replace) hits all locales identically, so the
 * cross-locale parity checks cannot see it.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Finding } from './types';
import { createCheck } from './types';

export const icuBraceBalance = createCheck({
  id: 'icu-brace-balance',
  scope: 'json',
  defaultMode: 'enforce',
  run(ctx) {
    if (!ctx.messagesDir) return [];
    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      const localeFile = path.join(ctx.messagesDir, `${locale.id}.json`);
      if (!fs.existsSync(localeFile)) continue;
      const messages = flatten(JSON.parse(fs.readFileSync(localeFile, 'utf8')));
      for (const [key, value] of messages) {
        const depth = braceDepth(value);
        if (depth === 0) continue;
        findings.push({
          file: path.relative(process.cwd(), localeFile),
          line: 0,
          key,
          locale: locale.id,
          rule: 'icu-brace-unbalanced',
          detail: `value has ${depth > 0 ? `${depth} unclosed {` : `${-depth} extra }`} — ICU cannot parse it`,
          suggest:
            depth > 0
              ? 'add the missing closing brace(s); plurals end with }} (category + argument)'
              : 'remove the stray closing brace(s)',
          doctrine: locale.doctrine,
        });
      }
    }
    return findings;
  },
});

/**
 * Net brace depth of a value, honouring ICU quoting: `''` is a literal
 * apostrophe, and `'` immediately before `{`, `}`, or `#` starts a quoted
 * literal run that ends at the next single `'`.
 */
function braceDepth(value: string): number {
  let depth = 0;
  let i = 0;
  while (i < value.length) {
    const ch = value[i];
    if (ch === "'") {
      if (value[i + 1] === "'") {
        i += 2;
        continue;
      }
      if (
        value[i + 1] === '{' ||
        value[i + 1] === '}' ||
        value[i + 1] === '#'
      ) {
        i += 2;
        while (i < value.length) {
          if (value[i] === "'") {
            if (value[i + 1] === "'") {
              i += 2;
              continue;
            }
            i++;
            break;
          }
          i++;
        }
        continue;
      }
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return depth;
}

function flatten(
  obj: unknown,
  prefix = '',
  out = new Map<string, string>(),
): Map<string, string> {
  if (typeof obj === 'string') {
    out.set(prefix, obj);
    return out;
  }
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}
