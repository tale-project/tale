import {
  modelCatalogEntrySchema,
  type ProviderDefinition,
} from '@tale/shared/schemas/providers';
import { describe, expect, it } from 'vitest';

import {
  ALLOWLIST_CATALOG_CONTEXT_WINDOW,
  synthesizeAllowlistCatalog,
} from './allowlist_catalog';

const AZURE = { name: 'azure', catalog: { source: 'none' } } as const;

/** An organization's own Anthropic-format gateway that describes three of
 * its models: one fully, two by their window alone. */
const GATEWAY: Pick<ProviderDefinition, 'name' | 'catalog'> = {
  name: 'claude-gateway',
  catalog: {
    source: 'none',
    models: [
      {
        id: 'claude-sonnet-gw',
        contextWindow: 1_000_000,
        supportsVision: true,
      },
      { id: 'claude-haiku-gw', contextWindow: 200_000 },
      { id: 'claude-retired-gw', contextWindow: 200_000 },
    ],
  },
};

describe('synthesizeAllowlistCatalog', () => {
  it('turns each allowlisted id into a neutral, schema-valid chat entry', () => {
    const entries = synthesizeAllowlistCatalog(AZURE, [
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
    const entries = synthesizeAllowlistCatalog(
      { name: 'nous-portal', catalog: { source: 'none' } },
      [' hermes-4 ', '', 'hermes-4', '  ', 'hermes-4-mini'],
    );
    expect(entries.map((entry) => entry.id)).toEqual([
      'hermes-4',
      'hermes-4-mini',
    ]);
  });

  it('yields an empty set for an absent or empty allowlist', () => {
    expect(synthesizeAllowlistCatalog(AZURE, undefined)).toEqual([]);
    expect(synthesizeAllowlistCatalog(AZURE, [])).toEqual([]);
    expect(synthesizeAllowlistCatalog(GATEWAY, [])).toEqual([]);
  });

  it('describes an allowlisted id with the facts its provider declares', () => {
    const [sonnet, haiku] = synthesizeAllowlistCatalog(GATEWAY, [
      'claude-sonnet-gw',
      // The allowlist is free text; the declaration names the bare id.
      ' claude-haiku-gw ',
    ]);
    expect(sonnet).toEqual({
      id: 'claude-sonnet-gw',
      provider: 'claude-gateway',
      tags: ['chat', 'vision'],
      supportsTools: true,
      supportsVision: true,
      contextWindow: 1_000_000,
    });
    // A fact the declaration leaves out keeps its neutral reading.
    expect(haiku).toEqual({
      id: 'claude-haiku-gw',
      provider: 'claude-gateway',
      tags: ['chat'],
      supportsTools: true,
      supportsVision: false,
      contextWindow: 200_000,
    });
    for (const entry of [sonnet, haiku])
      expect(modelCatalogEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('keeps the 128,000-token floor for an id its provider does not describe', () => {
    const [entry] = synthesizeAllowlistCatalog(GATEWAY, ['claude-opus-gw']);
    expect(entry).toMatchObject({
      id: 'claude-opus-gw',
      supportsVision: false,
      contextWindow: ALLOWLIST_CATALOG_CONTEXT_WINDOW,
    });
    expect(ALLOWLIST_CATALOG_CONTEXT_WINDOW).toBe(128_000);
  });

  it('never offers a declared model the allowlist does not name', () => {
    expect(
      synthesizeAllowlistCatalog(GATEWAY, ['claude-sonnet-gw']).map(
        (entry) => entry.id,
      ),
    ).toEqual(['claude-sonnet-gw']);
  });
});
