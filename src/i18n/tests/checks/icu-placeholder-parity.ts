/**
 * `icu-placeholder-parity` — the ICU arguments of a locale value, at any
 * depth, must match the base-locale value's for the same key. Catches
 * `{name}` renamed to `{nom}` in fr, missing placeholders, and an argument
 * the base value does not name (the code may not pass it, and a missing
 * argument makes the formatter render the raw ICU source). Runs for every
 * locale but the base, a regional locale's overrides (de-CH) included.
 */

import path from 'node:path';

import { catalogPath, readCatalog } from '../internals/catalog';
import { lexIcu } from '../scanner/icu-lexer';
import type { Finding } from './types';
import { createCheck } from './types';

export const icuPlaceholderParity = createCheck({
  id: 'icu-placeholder-parity',
  scope: 'json',
  defaultMode: 'enforce',
  localeFilter: (locale) => locale.id !== 'en',
  run(ctx) {
    if (!ctx.messagesDir) return [];
    const baseCatalog = readCatalog(ctx.messagesDir, 'en');
    if (baseCatalog === undefined) return [];
    const base = flatten(baseCatalog);

    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      if (locale.id === 'en') continue;
      const localeCatalog = readCatalog(ctx.messagesDir, locale.id);
      if (localeCatalog === undefined) continue;
      const localeFile = catalogPath(ctx.messagesDir, locale.id);
      for (const [key, locValue] of flatten(localeCatalog)) {
        const enValue = base.get(key);
        if (enValue === undefined || !locValue) continue;
        const enShape = lexIcu(enValue);
        const locShape = lexIcu(locValue);
        const missing = [...enShape.placeholders].filter(
          (p) => !locShape.placeholders.has(p),
        );
        const extra = [...locShape.placeholders].filter(
          (p) => !enShape.placeholders.has(p),
        );
        if (missing.length === 0 && extra.length === 0) continue;
        findings.push({
          file: path.relative(process.cwd(), localeFile),
          line: 0,
          key,
          locale: locale.id,
          rule: 'icu-placeholder-mismatch',
          detail: `placeholders mismatch [missing: ${missing.join(', ') || '∅'}, extra: ${extra.join(', ') || '∅'}]`,
          suggest: `match en: {${[...enShape.placeholders].join(', ')}}`,
          doctrine: locale.doctrine,
        });
      }
    }
    return findings;
  },
});

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
      flatten(v as unknown, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}
