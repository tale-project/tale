/**
 * `de-CH.yml` is a sparse overlay on `de.yml` (`de-CH → de → en`): an
 * override exists only to write the German text the Swiss way. Once `de`
 * changes, an override that still holds the old sentence silently keeps the
 * old claim for Swiss readers (#4119 corrected the cloud-provider pricing in
 * `de` while `de-CH` kept "bessere Preise"). So every override must equal its
 * `de` value with ß written as ss, unless its key is listed below as a real
 * regional variant — Swiss vocabulary, or «…» quotation marks.
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

function readLeaves(file: string): Map<string, unknown> {
  const leaves = new Map<string, unknown>();
  const walk = (node: unknown, prefix: string) => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [key, value] of Object.entries(node)) {
        walk(value, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }
    leaves.set(prefix, node);
  };
  walk(parse(readFileSync(path.join(MESSAGES_DIR, file), 'utf8')), '');
  return leaves;
}

const swiss = (german: string) => german.replaceAll('ß', 'ss');

describe('de-CH overlay', () => {
  const german = readLeaves('de.yml');
  const overrides = readLeaves('de-CH.yml');

  it('overrides only keys that exist in de', () => {
    expect([...overrides.keys()].filter((key) => !german.has(key))).toEqual([]);
  });

  it('writes each override as its de text with ss for ß', () => {
    const stale = [...overrides]
      .filter(([key]) => !(key in REGIONAL_VARIANTS))
      .flatMap(([key, value]) => {
        const source = german.get(key);
        if (typeof source !== 'string') return [];
        const expected = swiss(source);
        return value === expected ? [] : [{ key, expected, actual: value }];
      });
    expect(stale).toEqual([]);
  });

  it('keeps no override that repeats de, which would shadow later fixes', () => {
    expect(
      [...overrides]
        .filter(([key, value]) => value === german.get(key))
        .map(([key]) => key),
    ).toEqual([]);
  });

  it('lists only regional variants that still differ from de', () => {
    for (const key of Object.keys(REGIONAL_VARIANTS)) {
      const value = overrides.get(key);
      const source = german.get(key);
      expect(typeof value, key).toBe('string');
      expect(typeof source, key).toBe('string');
      expect(value, key).not.toBe(swiss(source as string));
    }
  });
});
