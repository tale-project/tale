/**
 * `icu-brace-balance` — every message value must have balanced `{`/`}`
 * braces (after ICU `'`-quoting is stripped). An unbalanced brace makes the
 * whole value unparseable as ICU, so plurals/placeholders render as raw
 * source text. Runs for every locale including en — a mechanical mangle
 * (e.g. a global `}}` → `}` replace) hits all locales identically, so the
 * cross-locale parity checks cannot see it.
 */

import path from 'node:path';

import { catalogPath, readCatalog } from '../internals/catalog';
import { skipIcuQuote } from '../scanner/icu-lexer';
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
      const catalog = readCatalog(ctx.messagesDir, locale.id);
      if (catalog === undefined) continue;
      const localeFile = catalogPath(ctx.messagesDir, locale.id);
      const messages = flatten(catalog);
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
 * Net brace depth of a value, honouring ICU quoting (`skipIcuQuote`): `''`
 * is a literal apostrophe, and `'` immediately before `{`, `}`, `<`, `>` or
 * `#` starts a quoted literal run that ends at the next single `'`. The
 * depth walk does not know which branch it is in, so `'#` counts as a quote
 * everywhere.
 */
function braceDepth(value: string): number {
  let depth = 0;
  let i = 0;
  while (i < value.length) {
    const ch = value[i];
    if (ch === "'") {
      i = skipIcuQuote(value, i, true);
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
