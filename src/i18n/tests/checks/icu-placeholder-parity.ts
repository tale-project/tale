/**
 * `icu-placeholder-parity` — every ICU placeholder in a primary-locale
 * value must match the placeholders in the base-locale value for the same
 * key. Catches `{name}` renamed to `{nom}` in fr, missing placeholders, etc.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { lexIcu } from '../scanner/icu-lexer';
import type { Finding } from './types';
import { createCheck } from './types';

export const icuPlaceholderParity = createCheck({
  id: 'icu-placeholder-parity',
  scope: 'json',
  defaultMode: 'enforce',
  localeFilter: (locale) => !locale.regional && locale.id !== 'en',
  run(ctx) {
    if (!ctx.messagesDir) return [];
    const baseFile = path.join(ctx.messagesDir, 'en.yml');
    if (!fs.existsSync(baseFile)) return [];
    const base = flatten(parseYaml(fs.readFileSync(baseFile, 'utf8')));

    const findings: Finding[] = [];
    for (const locale of ctx.locales) {
      if (locale.regional || locale.id === 'en') continue;
      const localeFile = path.join(ctx.messagesDir, `${locale.id}.json`);
      if (!fs.existsSync(localeFile)) continue;
      const localeMap = flatten(
        JSON.parse(fs.readFileSync(localeFile, 'utf8')),
      );
      for (const [key, enValue] of base) {
        const enShape = lexIcu(enValue);
        if (enShape.placeholders.size === 0) continue;
        const locValue = localeMap.get(key);
        if (!locValue) continue;
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
