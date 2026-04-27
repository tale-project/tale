import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const messagesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../messages',
);

const BASE_LOCALE = 'en';

// Shared file that is spread into every locale in i18n.ts — not a translation
// of its own, so it is excluded from parity checks.
const SHARED_FILES = new Set(['global.json']);

type Messages = Record<string, unknown>;

function loadLocale(locale: string): Messages {
  const file = path.join(messagesDir, `${locale}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Messages;
}

// Locales without a region subtag (e.g. `de`, `fr`) are standalone
// translations and must match the base. Locales with a region subtag
// (e.g. `de-CH`, `fr-CH`) are overrides layered via i18next's `fallbackLng`,
// so they may be partial.
function discoverLocales(): { primary: string[]; regional: string[] } {
  const primary: string[] = [];
  const regional: string[] = [];
  for (const file of fs.readdirSync(messagesDir)) {
    if (!file.endsWith('.json') || SHARED_FILES.has(file)) continue;
    const locale = file.slice(0, -'.json'.length);
    if (locale === BASE_LOCALE) continue;
    (locale.includes('-') ? regional : primary).push(locale);
  }
  primary.sort();
  regional.sort();
  return { primary, regional };
}

const { primary: PRIMARY_LOCALES, regional: REGIONAL_LOCALES } =
  discoverLocales();

function flatten(
  obj: Messages,
  prefix = '',
  out = new Set<string>(),
): Set<string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      flatten(v as Messages, key, out);
    } else {
      out.add(key);
    }
  }
  return out;
}

const baseKeys = flatten(loadLocale(BASE_LOCALE));

describe('i18n messages parity', () => {
  describe.each(PRIMARY_LOCALES)('primary locale %s', (locale) => {
    const keys = flatten(loadLocale(locale));

    it(`has every key from ${BASE_LOCALE}.json`, () => {
      const missing = [...baseKeys].filter((k) => !keys.has(k));
      expect(
        missing,
        `${locale}.json is missing ${missing.length} keys:\n  ${missing.join('\n  ')}`,
      ).toEqual([]);
    });

    it(`has no keys missing from ${BASE_LOCALE}.json`, () => {
      const extra = [...keys].filter((k) => !baseKeys.has(k));
      expect(
        extra,
        `${locale}.json has ${extra.length} keys not in ${BASE_LOCALE}.json:\n  ${extra.join('\n  ')}`,
      ).toEqual([]);
    });
  });

  describe.each(REGIONAL_LOCALES)('regional override %s', (locale) => {
    const keys = flatten(loadLocale(locale));

    it(`has no keys missing from ${BASE_LOCALE}.json`, () => {
      const extra = [...keys].filter((k) => !baseKeys.has(k));
      expect(
        extra,
        `${locale}.json has ${extra.length} orphan keys not in ${BASE_LOCALE}.json:\n  ${extra.join('\n  ')}`,
      ).toEqual([]);
    });
  });
});
