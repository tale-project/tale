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
      hits: duplicatePair('Refunds within 30 days.'),
      diagnostics: {},
    });
    const runQuery = vi.fn(async () => ['copy_a', 'copy_b']);
    const result = await searchKnowledge({ runQuery } as never, {
      organizationId: 'org_1',
      orgSlug: 'acme',
      query: 'refunds',
      access: ACCESS,
    });
    expect(result.hits.map((entry) => entry.source.ref)).toEqual(['copy_a']);
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
    expect(result.hits.map((entry) => entry.text)).toEqual([
      'First passage.',
      'Second passage.',
    ]);
  });

  it('treats two copies that only wrap differently as one', async () => {
    retrieveMock.mockResolvedValueOnce({
      hits: [
        { ...hit('documents', 'copy_a'), text: 'Refunds within\n30 days.' },
        { ...hit('documents', 'copy_b'), text: 'Refunds within 30 days.' },
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

  it('keeps the readable copy when the other is filtered out', async () => {
    // The order matters: deduping BEFORE the retrievability gate could keep
    // an unreadable copy and drop the readable one, and the gate would then
    // remove what was kept — losing the passage entirely.
    retrieveMock.mockResolvedValueOnce({
      hits: duplicatePair('Refunds within 30 days.'),
      diagnostics: {},
    });
    const runQuery = vi.fn(async () => ['copy_b']);
    const result = await searchKnowledge({ runQuery } as never, {
      organizationId: 'org_1',
      orgSlug: 'acme',
      query: 'refunds',
      access: ACCESS,
    });
    expect(result.hits.map((entry) => entry.source.ref)).toEqual(['copy_b']);
  });

  it('does not collapse the same text across different corpora', async () => {
    retrieveMock.mockResolvedValueOnce({
      hits: [
        { ...hit('documents', 'doc'), text: 'Shared wording.' },
        { ...hit('web', 'https://example.com'), text: 'Shared wording.' },
      ],
      diagnostics: {},
    });
    const runQuery = vi.fn(async () => ['doc']);
    const result = await searchKnowledge({ runQuery } as never, {
      organizationId: 'org_1',
      orgSlug: 'acme',
      query: 'shared',
      access: ACCESS,
    });
    expect(result.hits).toHaveLength(2);
  });
});
