import { beforeEach, describe, expect, it, vi } from 'vitest';

const retrieveMock = vi.fn();
vi.mock('../../../lib/knowledge/retrieve', () => ({
  retrieve: (...args: unknown[]) => retrieveMock(...args),
}));

vi.mock('../lib/handler_names', () => ({
  internal: {
    documents: {
      internal_queries: {
        filterRetrievableRagFileIds: 'filterRetrievableRagFileIds',
      },
    },
  },
}));

const readOrgEmbeddingConfig = vi.fn(
  async (_orgSlug: string): Promise<unknown> => null,
);
vi.mock('./connection', () => ({
  readOrgEmbeddingConfig: (orgSlug: string) => readOrgEmbeddingConfig(orgSlug),
}));
vi.mock('./dimensions', () => ({
  pinDimensions: vi.fn(async () => undefined),
}));
vi.mock('./embedding', () => ({
  embedderForOrg: vi.fn(async () => ({ dimensions: 3 })),
}));
vi.mock('./pool', () => ({
  getKnowledgePoolForOrg: vi.fn(async () => ({})),
  resolveOrgUrl: vi.fn(async () => 'postgresql://fake'),
}));
vi.mock('./corpus', () => ({
  DocumentCorpusReader: class {
    readonly corpus = 'documents';
  },
  WebCorpusReader: class {
    readonly corpus = 'web';
  },
}));

const { searchKnowledge } = await import('./search');

function hit(corpus: 'documents' | 'web', ref: string) {
  return {
    id: `${corpus}:${ref}`,
    corpus,
    text: ref,
    chunkIndex: 0,
    source: { ref, title: ref, url: corpus === 'web' ? ref : null },
    score: 1,
    fusedScore: 1,
  };
}

describe('searchKnowledge live document validation', () => {
  beforeEach(() => {
    retrieveMock.mockReset();
    readOrgEmbeddingConfig.mockReset();
    readOrgEmbeddingConfig.mockResolvedValue(null);
  });

  it('hands retrieval an admission seam that re-checks document hits — cache pools included', async () => {
    // The re-check is retrieval's ADMISSION step, run on the fused pool
    // before the page is cut (and on a semantic-cache pool, which can
    // outlive a replacement); the service no longer filters after the fact.
    retrieveMock.mockImplementationOnce(
      async (
        deps: { admit: (hits: unknown[]) => Promise<unknown[]> },
        _query: unknown,
      ) => ({
        hits: await deps.admit([
          hit('documents', 'current'),
          hit('documents', 'stale'),
          hit('web', 'https://example.com'),
        ]),
        diagnostics: {
          bm25: true,
          reranked: false,
          cached: true,
          admitted: 2,
          legs: { cache: 3 },
        },
      }),
    );
    const runQuery = vi.fn(async () => ['current']);
    const access = {
      teamIds: ['team-a'],
      projectIds: [],
      includeHub: true,
    };

    const result = await searchKnowledge({ runQuery } as never, {
      organizationId: 'org_1',
      orgSlug: 'acme',
      query: 'policy',
      folder: '/current',
      access,
    });

    expect(
      result.hits.map(
        (entry) => (entry as { source: { ref: string } }).source.ref,
      ),
    ).toEqual(['current', 'https://example.com']);
    expect(runQuery).toHaveBeenCalledWith('filterRetrievableRagFileIds', {
      organizationId: 'org_1',
      fileIds: ['current', 'stale'],
      folder: '/current',
      access,
    });
    expect(retrieveMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgSlug: 'acme', admit: expect.any(Function) }),
      expect.objectContaining({ query: 'policy', folder: '/current' }),
    );
  });

  it('admits a pool with no document hits without a re-check', async () => {
    retrieveMock.mockImplementationOnce(
      async (deps: { admit: (hits: unknown[]) => Promise<unknown[]> }) => ({
        hits: await deps.admit([hit('web', 'https://example.com')]),
        diagnostics: {},
      }),
    );
    const runQuery = vi.fn();
    const result = await searchKnowledge({ runQuery } as never, {
      organizationId: 'org_1',
      orgSlug: 'acme',
      query: 'policy',
    });
    expect(result.hits).toHaveLength(1);
    expect(runQuery).not.toHaveBeenCalled();
  });
});

/**
 * The dense-leg floor belongs to the embedding model, so it is configured
 * next to the model: `embedding.json` may state `minSimilarity`, and the
 * built-in assistant's search (`floorByDefault`) reads it — else the
 * built-in default. An explicit `minSimilarity` always wins, and a caller
 * that asks for neither (the REST door) gets no floor at all.
 */
describe('the assistant’s similarity floor', () => {
  const embedding = {
    providerSlug: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 3,
  };
  const empty = { hits: [], diagnostics: {} };

  beforeEach(() => {
    retrieveMock.mockReset();
    readOrgEmbeddingConfig.mockReset();
  });

  it('reads the organization’s configured floor when asked for the default', async () => {
    readOrgEmbeddingConfig.mockResolvedValue({
      ...embedding,
      minSimilarity: 0.6,
    });
    retrieveMock.mockResolvedValueOnce(empty);
    await searchKnowledge({ runQuery: vi.fn() } as never, {
      organizationId: 'org_1',
      orgSlug: 'acme',
      query: 'policy',
      floorByDefault: true,
    });
    expect(retrieveMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ minSimilarity: 0.6 }),
    );
  });

  it('falls back to the built-in default when the file states none', async () => {
    readOrgEmbeddingConfig.mockResolvedValue(embedding);
    retrieveMock.mockResolvedValueOnce(empty);
    await searchKnowledge({ runQuery: vi.fn() } as never, {
      organizationId: 'org_1',
      orgSlug: 'acme',
      query: 'policy',
      floorByDefault: true,
    });
    expect(retrieveMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ minSimilarity: 0.45 }),
    );
  });

  it('lets an explicit floor win over the configured one', async () => {
    readOrgEmbeddingConfig.mockResolvedValue({
      ...embedding,
      minSimilarity: 0.6,
    });
    retrieveMock.mockResolvedValueOnce(empty);
    await searchKnowledge({ runQuery: vi.fn() } as never, {
      organizationId: 'org_1',
      orgSlug: 'acme',
      query: 'policy',
      floorByDefault: true,
      minSimilarity: 0.2,
    });
    expect(retrieveMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ minSimilarity: 0.2 }),
    );
  });

  it('applies no floor to a caller that asks for none — the REST door', async () => {
    readOrgEmbeddingConfig.mockResolvedValue({
      ...embedding,
      minSimilarity: 0.6,
    });
    retrieveMock.mockResolvedValueOnce(empty);
    await searchKnowledge({ runQuery: vi.fn() } as never, {
      organizationId: 'org_1',
      orgSlug: 'acme',
      query: 'policy',
    });
    const query = retrieveMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect('minSimilarity' in query).toBe(false);
  });
});
