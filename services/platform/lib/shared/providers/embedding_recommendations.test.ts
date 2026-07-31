import { describe, expect, it } from 'vitest';

import { modelCatalogEntrySchema } from '../schemas/providers';
import { pickEmbeddingRecommendations } from './embedding_recommendations';

function entry(overrides: Record<string, unknown>) {
  return modelCatalogEntrySchema.parse({
    id: 'model',
    provider: 'p',
    tags: ['chat'],
    supportsTools: false,
    supportsVision: false,
    contextWindow: 8192,
    ...overrides,
  });
}

describe('pickEmbeddingRecommendations', () => {
  it('offers only embedding-tagged entries that carry the curated width', () => {
    const picks = pickEmbeddingRecommendations([
      {
        providerSlug: 'openrouter',
        entries: [
          entry({ id: 'chat-model' }),
          // Live-listed embedding model WITHOUT curated facts: nameable,
          // not recommendable — the width cannot be guessed.
          entry({ id: 'mystery-embed', tags: ['embedding'] }),
          entry({
            id: 'qwen/qwen3-embedding-8b',
            tags: ['embedding'],
            embedding: { dimensions: 1536, recommended: true },
          }),
        ],
      },
    ]);

    expect(picks).toEqual([
      {
        providerSlug: 'openrouter',
        model: 'qwen/qwen3-embedding-8b',
        dimensions: 1536,
        recommended: true,
      },
    ]);
  });

  it('sorts curated picks first, then stably by provider and model', () => {
    const picks = pickEmbeddingRecommendations([
      {
        providerSlug: 'zeta',
        entries: [
          entry({
            id: 'b-embed',
            tags: ['embedding'],
            embedding: { dimensions: 1024 },
          }),
        ],
      },
      {
        providerSlug: 'alpha',
        entries: [
          entry({
            id: 'a-embed',
            tags: ['embedding'],
            embedding: { dimensions: 768, recommended: true },
          }),
        ],
      },
    ]);

    expect(picks.map((p) => `${p.providerSlug}/${p.model}`)).toEqual([
      'alpha/a-embed',
      'zeta/b-embed',
    ]);
  });

  it('dedupes the same (provider, model) pair across catalog copies', () => {
    const duplicate = entry({
      id: 'e',
      tags: ['embedding'],
      embedding: { dimensions: 768 },
    });
    const picks = pickEmbeddingRecommendations([
      { providerSlug: 'p', entries: [duplicate, duplicate] },
    ]);
    expect(picks).toHaveLength(1);
  });
});
