import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

export interface MessagesParityConfig {
  /** Absolute path to the directory containing locale JSON files. */
  messagesDir: string;
  /** Base locale that all primary locales must match. Defaults to `'en'`. */
  baseLocale?: string;
  /**
   * File names that are spread into every locale (so they are not standalone
   * translations and must be excluded from parity checks). Defaults to
   * `['global.json']`.
   */
  sharedFiles?: string[];
}

type Messages = Record<string, unknown>;

function isMessages(v: unknown): v is Messages {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function loadLocale(messagesDir: string, locale: string): Messages {
  const file = path.join(messagesDir, `${locale}.json`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load locale "${locale}" from ${file} (messagesDir=${messagesDir}): ${cause}`,
      { cause: err },
    );
  }
  if (!isMessages(raw)) {
    throw new Error(
      `Expected JSON object at top level of ${file}, got ${Array.isArray(raw) ? 'array' : typeof raw}.`,
    );
  }
  return raw;
}

function flatten(
  obj: Messages,
  prefix = '',
  out = new Set<string>(),
): Set<string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isMessages(v)) {
      flatten(v, key, out);
    } else {
      out.add(key);
    }
  }
  return out;
}

/**
 * Registers vitest `describe`/`it` blocks that verify locale parity:
 * - Primary locales (no region subtag, e.g. `de`, `fr`) must match the base
 *   locale's key set exactly.
 * - Regional overrides (e.g. `de-CH`, `fr-CH`) are layered via
 *   `i18next`'s `fallbackLng` and may be partial, but must not contain keys
 *   absent from the base.
 */
export function defineMessagesParityTests(config: MessagesParityConfig): void {
  const {
    messagesDir,
    baseLocale = 'en',
    sharedFiles = ['global.json'],
  } = config;
  const sharedSet = new Set(sharedFiles);

  const primary: string[] = [];
  const regional: string[] = [];
  for (const file of fs.readdirSync(messagesDir)) {
    if (!file.endsWith('.json') || sharedSet.has(file)) continue;
    const locale = file.slice(0, -'.json'.length);
    if (locale === baseLocale) continue;
    (locale.includes('-') ? regional : primary).push(locale);
  }
  primary.sort();
  regional.sort();

  const baseKeys = flatten(loadLocale(messagesDir, baseLocale));

  describe('i18n messages parity', () => {
    describe.for(primary)('primary locale %s', (locale) => {
      const keys = flatten(loadLocale(messagesDir, locale));

      it(`has every key from ${baseLocale}.json`, () => {
        const missing = [...baseKeys].filter((k) => !keys.has(k));
        expect(
          missing,
          `${locale}.json is missing ${missing.length} keys:\n  ${missing.join('\n  ')}`,
        ).toEqual([]);
      });

      it(`has no extra keys not present in ${baseLocale}.json`, () => {
        const extra = [...keys].filter((k) => !baseKeys.has(k));
        expect(
          extra,
          `${locale}.json has ${extra.length} keys not in ${baseLocale}.json:\n  ${extra.join('\n  ')}`,
        ).toEqual([]);
      });
    });

    describe.for(regional)('regional override %s', (locale) => {
      const keys = flatten(loadLocale(messagesDir, locale));

      it(`has no extra keys not present in ${baseLocale}.json`, () => {
        const extra = [...keys].filter((k) => !baseKeys.has(k));
        expect(
          extra,
          `${locale}.json has ${extra.length} orphan keys not in ${baseLocale}.json:\n  ${extra.join('\n  ')}`,
        ).toEqual([]);
      });
    });
  });
}
