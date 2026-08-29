import { beforeEach, describe, expect, it, vi } from 'vitest';

const retrieveMock = vi.fn();
vi.mock('../../lib/knowledge/retrieve', () => ({
  retrieve: (...args: unknown[]) => retrieveMock(...args),
}));

vi.mock('../_generated/api', () => ({
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

describe('searchKnowledge — the same passage twice', () => {
  beforeEach(() => {
    retrieveMock.mockReset();
  });

  /** Two refs holding identical text — the same file indexed twice. */
  function duplicatePair(text: string) {
    return [
      { ...hit('documents', 'copy_a'), text, fusedScore: 0.9 },
      { ...hit('documents', 'copy_b'), text, fusedScore: 0.4 },
    ];
  }

  const ACCESS = { teamIds: [], projectIds: [], includeHub: true };

  it('returns one copy, keeping the higher-scoring ref', async () => {
    // A bounded result set spending two slots on one passage pushes a
    // different answer off the end.
    retrieveMock.mockResolvedValueOnce({
      hits: [...duplicatePair('Refunds within 30 days.')],
      diagnostics: {},
    });
    const runQuery = vi.fn(async () => ['copy_a', 'copy_b']);
    const result = await searchKnowledge({ runQuery } as never, {
      organizationId: 'org_1',
      orgSlug: 'acme',
      query: 'refunds',
      access: ACCESS,
    });
    expect(result.hits.map((h) => h.source.ref)).toEqual(['copy_a']);
  });

  it('keeps a distinct passage from the same document', async () => {
    // Deduping is per passage, not per document — a second chunk of the same
    // file is a different answer.
    retrieveMock.mockResolvedValueOnce({
      hits: [
        { ...hit('documents', 'doc'), text: 'First passage.' },
        { ...hit('documents', 'doc'), text: 'Second passage.' },
      ],
      diagnostics: {},
    });
    const runQuery = vi.fn(async () => ['doc']);
    const result = await searchKnowledge({ runQuery } as never, {
      organizationId: 'org_1',
      orgSlug: 'acme',
      query: 'passages',
      access: ACCESS,
    });
    expect(result.hits).toHaveLength(2);
  });

  it('treats copies that differ only in whitespace as one', async () => {
    retrieveMock.mockResolvedValueOnce({
      hits: [
        { ...hit('documents', 'copy_a'), text: 'Refunds within 30 days.' },
        {
          ...hit('documents', 'copy_b'),
          text: 'Refunds   within\n30 days.',
        },
      ],
      diagnostics: {},
    });
    const runQuery = vi.fn(async () => ['copy_a', 'copy_b']);
    const result = await searchKnowledge({ runQuery } as never, {
      organizationId: 'org_1',
      orgSlug: 'acme',
      query: 'refunds',
      access: ACCESS,
    });
    expect(result.hits).toHaveLength(1);
  });

  it('keeps the readable copy when the better-scoring one is denied', async () => {
    // THE ordering case. Deduping before the retrievability filter would keep
    // `copy_a`, the gate would then drop it, and the passage would vanish
    // entirely — worse than showing it twice.
    retrieveMock.mockResolvedValueOnce({
      hits: [...duplicatePair('Refunds within 30 days.')],
      diagnostics: {},
    });
    const runQuery = vi.fn(async () => ['copy_b']);
    const result = await searchKnowledge({ runQuery } as never, {
      organizationId: 'org_1',
      orgSlug: 'acme',
      query: 'refunds',
      access: ACCESS,
    });
    expect(result.hits.map((h) => h.source.ref)).toEqual(['copy_b']);
  });

  it('does not collapse identical text across different corpora', async () => {
    // A web page and a document saying the same thing are two findings, and
    // only one of them is citable by URL.
    retrieveMock.mockResolvedValueOnce({
      hits: [
        { ...hit('documents', 'doc'), text: 'Same words.' },
        { ...hit('web', 'https://example.com'), text: 'Same words.' },
      ],
      diagnostics: {},
    });
    const runQuery = vi.fn(async () => ['doc']);
    const result = await searchKnowledge({ runQuery } as never, {
      organizationId: 'org_1',
      orgSlug: 'acme',
      query: 'same',
      access: ACCESS,
    });
    expect(result.hits).toHaveLength(2);
  });
});
