import { describe, expect, it } from 'vitest';

import { modelCatalogEntrySchema } from '../schemas/providers';
import {
  ALLOWLIST_CATALOG_CONTEXT_WINDOW,
  synthesizeAllowlistCatalog,
} from './allowlist_catalog';

describe('synthesizeAllowlistCatalog', () => {
  it('turns each allowlisted id into a neutral, schema-valid chat entry', () => {
    const entries = synthesizeAllowlistCatalog({ name: 'azure' }, [
      'gpt-5-prod',
      'o4-mini-eu',
    ]);
    expect(entries.map((entry) => entry.id)).toEqual([
      'gpt-5-prod',
      'o4-mini-eu',
    ]);
    for (const entry of entries) {
      expect(modelCatalogEntrySchema.safeParse(entry).success).toBe(true);
      expect(entry).toMatchObject({
        provider: 'azure',
        tags: ['chat'],
        supportsTools: true,
        supportsVision: false,
        contextWindow: ALLOWLIST_CATALOG_CONTEXT_WINDOW,
      });
      // No invented price: an unknown rate must book as an honest zero.
      expect(entry.pricing).toBeUndefined();
    }
  });

  it('trims, drops blanks, and de-duplicates the free-text ids', () => {
    const entries = synthesizeAllowlistCatalog({ name: 'nous-portal' }, [
      ' hermes-4 ',
      '',
      'hermes-4',
      '  ',
      'hermes-4-mini',
    ]);
    expect(entries.map((entry) => entry.id)).toEqual([
      'hermes-4',
      'hermes-4-mini',
    ]);
  });

  it('yields an empty set for an absent or empty allowlist', () => {
    expect(synthesizeAllowlistCatalog({ name: 'azure' }, undefined)).toEqual(
      [],
    );
    expect(synthesizeAllowlistCatalog({ name: 'azure' }, [])).toEqual([]);
  });
});
