import { beforeEach, describe, expect, it, vi } from 'vitest';

const retrieveMock = vi.fn();
vi.mock('../../lib/knowledge/retrieve', () => ({
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

vi.mock('./connection', () => ({
  readOrgEmbeddingConfig: vi.fn(async () => null),
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
  });

  it('filters stale document hits from fresh and semantic-cache results', async () => {
    retrieveMock.mockResolvedValueOnce({
      hits: [
        hit('documents', 'current'),
        hit('documents', 'stale'),
        hit('web', 'https://example.com'),
      ],
      diagnostics: {
        bm25: true,
        reranked: false,
        cached: true,
        legs: { cache: 3 },
      },
    });
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

    expect(result.hits.map((entry) => entry.source.ref)).toEqual([
      'current',
      'https://example.com',
    ]);
    expect(runQuery).toHaveBeenCalledWith('filterRetrievableRagFileIds', {
      organizationId: 'org_1',
      fileIds: ['current', 'stale'],
      folder: '/current',
      access,
    });
  });
});
