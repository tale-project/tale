import { describe, expect, it } from 'vitest';

import { modelCatalogEntrySchema } from '../schemas/providers';
import {
  pickEmbeddingRecommendations,
  providerEmbeddingOptions,
} from './embedding_recommendations';

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

/**
 * The declaration exists so the form can tell "cannot embed" from "no
 * curated width here". Both readings used to render one empty state, and the
 * fields stayed free either way — which is how a chat-only provider got
 * chosen and failed later, at index time.
 */
describe('providerEmbeddingOptions', () => {
  const openai = {
    providerSlug: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 1536,
    recommended: true,
  };

  it('recommends only where a curated width actually ships', () => {
    const [option] = providerEmbeddingOptions(
      [{ slug: 'openai', embedding: 'supported' }],
      [openai],
    );

    expect(option).toEqual({
      providerSlug: 'openai',
      support: 'supported',
      recommendations: [openai],
    });
  });

  it('reports a declared-unsupported provider as unsupported', () => {
    const [option] = providerEmbeddingOptions(
      [{ slug: 'anthropic', embedding: 'unsupported' }],
      [],
    );

    expect(option?.support).toBe('unsupported');
    expect(option?.recommendations).toEqual([]);
  });

  it('treats an unclassified provider as unknown, never unsupported', () => {
    // A connector nobody has classified must not be refused — only left
    // un-recommended, with the manual path open.
    const [option] = providerEmbeddingOptions([{ slug: 'newcomer' }], []);

    expect(option?.support).toBe('unknown');
  });

  it('downgrades supported to unknown when this deployment has no width', () => {
    // The declaration says it can embed; the catalog here still offers no
    // dimensions. "Enter them yourself" is the state to act on, not "cannot".
    const [option] = providerEmbeddingOptions(
      [{ slug: 'openai', embedding: 'supported' }],
      [],
    );

    expect(option?.support).toBe('unknown');
    expect(option?.recommendations).toEqual([]);
  });

  it('lets the declaration win over a contradictory recommendation', () => {
    // A curated width can outlive the truth — a catalog entry kept after the
    // provider dropped its embeddings API, say. The declaration is the
    // authority, so the form must not offer a one-click pick that cannot
    // work.
    const [option] = providerEmbeddingOptions(
      [{ slug: 'anthropic', embedding: 'unsupported' }],
      [{ ...openai, providerSlug: 'anthropic' }],
    );

    expect(option?.support).toBe('unsupported');
    expect(option?.recommendations).toEqual([]);
  });

  it('never attaches another provider’s recommendations', () => {
    const options = providerEmbeddingOptions(
      [
        { slug: 'anthropic', embedding: 'unsupported' },
        { slug: 'openai', embedding: 'supported' },
      ],
      [openai],
    );

    expect(options.map((option) => option.providerSlug)).toEqual([
      'anthropic',
      'openai',
    ]);
    expect(options[0]?.recommendations).toEqual([]);
    expect(options[1]?.recommendations).toEqual([openai]);
  });
});
