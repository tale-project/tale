import { describe, expect, it } from 'vitest';

import { readCatalog } from './internals/catalog';

/** Find German strings that would fall back to a sharp s for Swiss readers. */
export function missingSwissForms(
  german: unknown,
  swiss: unknown,
  prefix = '',
): string[] {
  if (typeof german === 'string') {
    return german.includes('ß') &&
      (typeof swiss !== 'string' || swiss.includes('ß'))
      ? [prefix]
      : [];
  }
  if (!german || typeof german !== 'object') return [];
  const overlay = swiss && typeof swiss === 'object' ? swiss : {};
  return Object.entries(german).flatMap(([key, value]) =>
    missingSwissForms(
      value,
      Reflect.get(overlay, key),
      prefix ? `${prefix}.${key}` : key,
    ),
  );
}

/** Sparse overlays must cover every sharp-s-bearing German leaf, including arrays. */
export function defineSwissCoverageTests(messagesDir: string): void {
  const swiss = readCatalog(messagesDir, 'de-CH');
  if (swiss === undefined) return;
  describe('de-CH fallback coverage', () => {
    it('provides a Swiss form for every German string containing ß', () => {
      const german = readCatalog(messagesDir, 'de');
      expect(missingSwissForms(german, swiss)).toEqual([]);
    });
  });
}
