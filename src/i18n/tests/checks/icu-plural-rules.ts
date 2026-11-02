/**
 * `icu-plural-rules` — when the base-locale value uses an ICU cardinal
 * `plural`, the locale value must use one too; and every cardinal plural
 * in a locale value, nested ones included, must give the CLDR categories
 * its language distinguishes (`=1` gives `one`). Runs for every locale but
 * the base, a regional locale's overrides (de-CH) included.
 */

import path from 'node:path';

import { catalogPath, readCatalog } from '../internals/catalog';
import { requiredCategories } from '../internals/plural-data';
import { lexIcu } from '../scanner/icu-lexer';
import type { Finding } from './types';
import { createCheck } from './types';

export const icuPluralRules = createCheck({
  id: 'icu-plural-rules',
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
      const required = requiredCategories(locale.id);
      for (const [key, locValue] of flatten(localeCatalog)) {
        const enValue = base.get(key);
        if (enValue === undefined || !locValue) continue;
        const locShape = lexIcu(locValue);
        if (!locShape.hasPlural) {
          if (!lexIcu(enValue).hasPlural) continue;
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
        const reported = new Set<string>();
        for (const plural of locShape.plurals) {
          if (plural.kind !== 'plural') continue;
          const missing = required.filter(
            (c) =>
              !plural.categories.has(c) &&
              !(c === 'one' && plural.categories.has('=1')),
          );
          if (missing.length === 0) continue;
          const detail = `placeholder "${plural.name}" missing categories: ${missing.join(', ')}`;
          if (reported.has(detail)) continue;
          reported.add(detail);
          findings.push({
            file: path.relative(process.cwd(), localeFile),
            line: 0,
            key,
            locale: locale.id,
            rule: 'icu-plural-categories-missing',
            detail,
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
