/**
 * `icu-plural-rules` — when a base-locale value uses ICU `plural`, the
 * primary-locale value must use plural too, and must include the required
 * CLDR categories for the locale.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { requiredCategories } from '../internals/plural-data';
import { lexIcu } from '../scanner/icu-lexer';
import type { Finding } from './types';
import { createCheck } from './types';

export const icuPluralRules = createCheck({
  id: 'icu-plural-rules',
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
      const required = requiredCategories(locale.id);
      for (const [key, enValue] of base) {
        const enShape = lexIcu(enValue);
        if (!enShape.hasPlural) continue;
        const locValue = localeMap.get(key);
        if (!locValue) continue;
        const locShape = lexIcu(locValue);
        if (!locShape.hasPlural) {
          findings.push({
            file: path.relative(process.cwd(), localeFile),
            line: 0,
            key,
            locale: locale.id,
            rule: 'icu-plural-missing',
            detail: 'base value uses ICU plural; locale value does not',
            doctrine: locale.doctrine,
          });
          continue;
        }
        for (const [placeholder, cats] of locShape.pluralCategories) {
          const missing = required.filter((c) => !cats.has(c));
          if (missing.length === 0) continue;
          findings.push({
            file: path.relative(process.cwd(), localeFile),
            line: 0,
            key,
            locale: locale.id,
            rule: 'icu-plural-categories-missing',
            detail: `placeholder "${placeholder}" missing categories: ${missing.join(', ')}`,
            suggest: `add ${missing.map((c) => `${c} {…}`).join(', ')}`,
            doctrine: locale.doctrine,
          });
        }
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
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}
