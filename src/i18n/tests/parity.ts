import { describe, expect, it } from 'vitest';

import {
  catalogTopics,
  listCatalogLocales,
  readCatalog,
} from './internals/catalog';

interface MessagesParityConfig {
  /**
   * Absolute path to the directory holding the locale catalogs, each a
   * `<locale>.yml` file or a `<locale>/` directory of topic files.
   */
  messagesDir: string;
  /** Base locale that all primary locales must match. Defaults to `'en'`. */
  baseLocale?: string;
  /**
   * File names that are spread into every locale (so they are not standalone
   * translations and must be excluded from parity checks). Defaults to
   * `['global.yml']`.
   */
  sharedFiles?: string[];
}

type Messages = Record<string, unknown>;

function isMessages(v: unknown): v is Messages {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function loadLocale(messagesDir: string, locale: string): Messages {
  const catalog = readCatalog(messagesDir, locale);
  if (catalog === undefined) {
    throw new Error(
      `No catalog for locale "${locale}" in ${messagesDir} (neither ${locale}.yml nor ${locale}/).`,
    );
  }
  return catalog;
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
 * - Regional overrides (e.g. `de-CH`) are layered via
 *   `i18next`'s `fallbackLng` and may be partial, but must not contain keys
 *   absent from the base.
 */
export function defineMessagesParityTests(config: MessagesParityConfig): void {
  const {
    messagesDir,
    baseLocale = 'en',
    sharedFiles = ['global.yml'],
  } = config;
  const sharedSet = new Set(sharedFiles);

  const primary: string[] = [];
  const regional: string[] = [];
  for (const locale of listCatalogLocales(messagesDir, [...sharedSet])) {
    if (locale === baseLocale) continue;
    (locale.includes('-') ? regional : primary).push(locale);
  }

  const baseKeys = flatten(loadLocale(messagesDir, baseLocale));
  // A catalog split into topic files is split the same way in every locale.
  const baseTopics = catalogTopics(messagesDir, baseLocale);

  describe('i18n messages parity', () => {
    describe.for(primary)('primary locale %s', (locale) => {
      const keys = flatten(loadLocale(messagesDir, locale));

      if (baseTopics.length > 0) {
        it(`has the topic files of ${baseLocale}/, and no others`, () => {
          expect(catalogTopics(messagesDir, locale)).toEqual(baseTopics);
        });
      }

      it(`has every key from ${baseLocale}.yml`, () => {
        const missing = [...baseKeys].filter((k) => !keys.has(k));
        expect(
          missing,
          `${locale}.json is missing ${missing.length} keys:\n  ${missing.join('\n  ')}`,
        ).toEqual([]);
      });

      it(`has no extra keys not present in ${baseLocale}.yml`, () => {
        const extra = [...keys].filter((k) => !baseKeys.has(k));
        expect(
          extra,
          `${locale}.json has ${extra.length} keys not in ${baseLocale}.json:\n  ${extra.join('\n  ')}`,
        ).toEqual([]);
      });
    });

    describe.for(regional)('regional override %s', (locale) => {
      const keys = flatten(loadLocale(messagesDir, locale));

      if (baseTopics.length > 0) {
        it(`overrides only topics ${baseLocale}/ has, one file each`, () => {
          const topics = catalogTopics(messagesDir, locale);
          expect(
            topics.length,
            `${locale} is not split into topic files`,
          ).toBeGreaterThan(0);
          expect(topics.filter((topic) => !baseTopics.includes(topic))).toEqual(
            [],
          );
        });
      }

      it(`has no extra keys not present in ${baseLocale}.yml`, () => {
        const extra = [...keys].filter((k) => !baseKeys.has(k));
        expect(
          extra,
          `${locale}.json has ${extra.length} orphan keys not in ${baseLocale}.json:\n  ${extra.join('\n  ')}`,
        ).toEqual([]);
      });
    });
  });
}
