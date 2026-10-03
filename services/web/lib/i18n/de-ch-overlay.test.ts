/**
 * `de-CH.yml` is a sparse overlay on `de.yml` (`de-CH → de → en`): an
 * override exists only to write the German text the Swiss way. Once `de`
 * changes, an override that still holds the old sentence silently keeps the
 * old claim for Swiss readers (#4119 corrected the cloud-provider pricing in
 * `de` while `de-CH` kept "bessere Preise"). So every override must equal its
 * `de` value with ß written as ss, unless its key is listed below as a real
 * regional variant — Swiss vocabulary, or «…» quotation marks.
 *
 * Keys the overlay names but `de` lacks are the shared parity suite's job
 * (`messages.test.ts`).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const MESSAGES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../messages',
);

/** Keys whose Swiss text may differ from `de` beyond ß → ss, with the reason. */
const REGIONAL_VARIANTS: Readonly<Record<string, string>> = {};

/**
 * Every value of a catalog by its dotted key. An array is one value: an
 * override replaces it whole, as i18next returns it.
 */
function readValues(file: string): Map<string, unknown> {
  const values = new Map<string, unknown>();
  const walk = (node: unknown, prefix: string) => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [key, value] of Object.entries(node)) {
        walk(value, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }
    values.set(prefix, node);
  };
  walk(parse(readFileSync(path.join(MESSAGES_DIR, file), 'utf8')), '');
  return values;
}

/** A `de` value as Swiss readers get it: ß as ss in every string it holds. */
function swiss(value: unknown): unknown {
  if (typeof value === 'string') return value.replaceAll('ß', 'ss');
  if (Array.isArray(value)) return value.map(swiss);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, swiss(item)]),
    );
  }
  return value;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

describe('de-CH overlay', () => {
  const german = readValues('de.yml');
  const overrides = [...readValues('de-CH.yml')].filter(([key]) =>
    german.has(key),
  );

  it('writes each override as its de text with ss for ß', () => {
    const stale = overrides
      .filter(([key]) => !Object.hasOwn(REGIONAL_VARIANTS, key))
      .filter(([key, value]) => !same(value, swiss(german.get(key))))
      .map(([key, value]) => ({
        key,
        expected: swiss(german.get(key)),
        actual: value,
      }));
    expect(stale).toEqual([]);
  });

  it('keeps no override that repeats de, which would shadow later fixes', () => {
    expect(
      overrides
        .filter(([key, value]) => same(value, german.get(key)))
        .map(([key]) => key),
    ).toEqual([]);
  });

  it('lists only regional variants that still differ from de', () => {
    const values = new Map(overrides);
    for (const key of Object.keys(REGIONAL_VARIANTS)) {
      expect(values.has(key), key).toBe(true);
      expect(same(values.get(key), swiss(german.get(key))), key).toBe(false);
    }
  });
});
