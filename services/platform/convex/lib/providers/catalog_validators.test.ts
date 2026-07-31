// @vitest-environment node

import { validate } from 'convex-helpers/validators';
import { describe, expect, it } from 'vitest';

import type { ModelCatalogEntry } from '../../../lib/shared/schemas/providers';
import { modelEntryValidator } from './catalog_validators';
import { loadStaticCatalogs } from './load_system_config';

// The Zod catalog schema (`modelCatalogEntrySchema`) is the source of truth
// for what a catalog entry may carry; `modelEntryValidator` is the Convex
// wire mirror the providers settings surface returns through. Drift between
// the two is an outage, not a type nit: one entry with an unmirrored field
// fails return validation and blanks the whole listing (how the `tts` field
// broke the providers page). These tests pin the mirror from both sides —
// the real shipped data, and a schema-complete synthetic entry.

describe('modelEntryValidator mirrors the catalog entry schema', () => {
  it('accepts every shipped static catalog entry', () => {
    const catalogs = loadStaticCatalogs();
    expect(catalogs.size).toBeGreaterThan(0);
    for (const [provider, entries] of catalogs) {
      for (const entry of entries) {
        expect(
          () => validate(modelEntryValidator, entry, { throw: true }),
          `${provider}/${entry.id}`,
        ).not.toThrow();
      }
    }
  });

  it('accepts a maximal entry exercising every schema field', () => {
    // `satisfies Required<...>` forces this fixture to grow whenever the Zod
    // schema grows — a new catalog field turns this test red at typecheck
    // until the wire validator mirrors it, instead of the providers page
    // failing at runtime.
    const maximalTts = {
      defaultVoice: 'alloy',
      voicesByLocale: { de: 'onyx', 'de-CH': 'onyx', en: 'alloy' },
      defaultInstructions: 'Speak calmly and clearly.',
      instructionsByLocale: { de: 'Ruhig und deutlich sprechen.' },
      audioFormat: 'wav',
      centsPerMillionCharacters: 1200,
    } satisfies Required<NonNullable<ModelCatalogEntry['tts']>>;
    const maximal = {
      id: 'gpt-4o-mini-tts',
      provider: 'openai',
      tags: ['text-to-speech'],
      supportsTools: false,
      supportsVision: false,
      reasoning: { knob: 'effort' },
      contextWindow: 2000,
      maxOutputTokens: 16_000,
      pricing: { inputCentsPerMillion: 60, outputCentsPerMillion: 240 },
      tts: maximalTts,
      embedding: { dimensions: 1536, recommended: true },
    } satisfies Required<ModelCatalogEntry>;
    expect(() =>
      validate(modelEntryValidator, maximal, { throw: true }),
    ).not.toThrow();
  });
});
