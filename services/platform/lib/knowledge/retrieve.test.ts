import { afterEach, describe, expect, it } from 'vitest';

import { setKnowledgeCache, type KnowledgeCache } from './cache';
import { setKnowledgeReranker, type KnowledgeReranker } from './rerank';
import {
  retrieve,
  type CorpusLegQuery,
  type CorpusReader,
  type QueryEmbedder,
} from './retrieve';
import type { KnowledgeCorpus, KnowledgeHit } from './types';

/**
 * Retrieval is tested against stub corpus readers rather than a database: the
 * behaviours that matter are what happens when a leg is UNAVAILABLE, when a
 * reranker misbehaves, and when a cache is or is not installed — none of which
 * a live ParadeDB would let us provoke reliably.
 *
 * The reranker and cache seams are process-global, so every test that installs
 * one clears it again; a leaked reranker would silently change every later
 * test's ranking.
 */

const EMBEDDING = [0.1, 0.2, 0.3];

const embedder: QueryEmbedder = { embed: () => Promise.resolve(EMBEDDING) };

function hit(
  id: string,
  corpus: Exclude<KnowledgeCorpus, 'all'>,
  score: number,
): KnowledgeHit {
  return {
    id,
    corpus,
    text: `passage ${id}`,
    chunkIndex: 0,
    source: { ref: `doc-${id}`, title: `Document ${id}` },
    score,
  };
}

interface StubOptions {
  corpus?: Exclude<KnowledgeCorpus, 'all'>;
  /** `null` models a database with no full-text index. */
  keyword?: readonly KnowledgeHit[] | null;
  dense?: readonly KnowledgeHit[];
}

function stubReader(options: StubOptions = {}): CorpusReader & {
  calls: CorpusLegQuery[];
} {
  const corpus = options.corpus ?? 'documents';
  const calls: CorpusLegQuery[] = [];
  return {
    corpus,
    calls,
    keyword(query) {
      calls.push(query);
      return Promise.resolve(
        options.keyword === undefined
          ? [hit('kw', corpus, 12), hit('shared', corpus, 8)]
          : options.keyword,
      );
    },
    dense(query) {
      calls.push(query);
      return Promise.resolve(
        options.dense ?? [
          hit('dense', corpus, 0.9),
          hit('shared', corpus, 0.7),
        ],
      );
    },
  };
}

afterEach(() => {
  setKnowledgeReranker(null);
  setKnowledgeCache(null);
});

describe('hybrid search is the default', () => {
  it('runs both legs and fuses them without being asked to', () => {
    return retrieve(
      { readers: [stubReader()], embedder, orgSlug: 'acme' },
      { query: 'holiday policy' },
    ).then((result) => {
      // The result both legs found outranks each leg's own favourite, and
      // nothing in the query switched fusion on. The two single-leg results
      // tie on score, so the deterministic tie-break orders them by identity.
      expect(result.hits.map((entry) => entry.id)).toEqual([
        'shared',
        'dense',
        'kw',
      ]);
      expect(result.diagnostics.bm25).toBe(true);
      expect(result.diagnostics.reranked).toBe(false);
      expect(result.diagnostics.cached).toBe(false);
    });
  });

  it('over-fetches per leg so agreement can outrank a single leg', async () => {
    const reader = stubReader();
    await retrieve(
      { readers: [reader], embedder, orgSlug: 'acme' },
      { query: 'holiday policy', limit: 5 },
    );
    for (const call of reader.calls) expect(call.limit).toBe(15);
  });

  it('searches both corpora when none is named', async () => {
    const documents = stubReader({ corpus: 'documents' });
    const web = stubReader({ corpus: 'web' });
    const result = await retrieve(
      { readers: [documents, web], embedder, orgSlug: 'acme' },
      { query: 'holiday policy' },
    );
    const corpora = new Set(result.hits.map((entry) => entry.corpus));
    expect(corpora).toEqual(new Set(['documents', 'web']));
  });

  it('searches only the named corpus', async () => {
    const documents = stubReader({ corpus: 'documents' });
    const web = stubReader({ corpus: 'web' });
    const result = await retrieve(
      { readers: [documents, web], embedder, orgSlug: 'acme' },
      { query: 'holiday policy', corpus: 'web' },
    );
    expect(web.calls.length).toBeGreaterThan(0);
    expect(documents.calls).toEqual([]);
    for (const entry of result.hits) expect(entry.corpus).toBe('web');
  });
});

describe('the keyword index is optional', () => {
  it('still returns dense results when there is no full-text index', async () => {
    // A managed Postgres without ParadeDB. Retrieval must degrade, not fail:
    // erroring here would make every such deployment unable to search at all.
    const result = await retrieve(
      { readers: [stubReader({ keyword: null })], embedder, orgSlug: 'acme' },
      { query: 'holiday policy' },
    );
    expect(result.hits.map((entry) => entry.id)).toEqual(['dense', 'shared']);
    expect(result.diagnostics.bm25).toBe(false);
  });

  it('reports a healthy search that matched nothing as healthy', async () => {
    // An empty keyword list is not the same as a missing index, and a caller
    // that cannot tell them apart cannot report the difference either.
    const result = await retrieve(
      { readers: [stubReader({ keyword: [] })], embedder, orgSlug: 'acme' },
      { query: 'holiday policy' },
    );
    expect(result.diagnostics.bm25).toBe(true);
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it('returns nothing, without failing, when both legs are empty', async () => {
    const result = await retrieve(
      {
        readers: [stubReader({ keyword: [], dense: [] })],
        embedder,
        orgSlug: 'acme',
      },
      { query: 'holiday policy' },
    );
    expect(result.hits).toEqual([]);
  });
});

describe('filters narrow the search', () => {
  it('drops dense matches below the similarity floor', async () => {
    const result = await retrieve(
      {
        readers: [
          stubReader({
            keyword: [],
            dense: [
              hit('near', 'documents', 0.9),
              hit('far', 'documents', 0.2),
            ],
          }),
        ],
        embedder,
        orgSlug: 'acme',
      },
      { query: 'holiday policy', minSimilarity: 0.5 },
    );
    expect(result.hits.map((entry) => entry.id)).toEqual(['near']);
  });

  it('passes the document and folder restrictions to both legs', async () => {
    const reader = stubReader();
    await retrieve(
      { readers: [reader], embedder, orgSlug: 'acme' },
      { query: 'holiday policy', refs: ['a', 'b'], folder: '/hr' },
    );
    for (const call of reader.calls) {
      expect(call.refs).toEqual(['a', 'b']);
      expect(call.folder).toBe('/hr');
    }
  });

  it('caps the limit and floors it at one', async () => {
    const many = Array.from({ length: 200 }, (_v, i) =>
      hit(`d${i}`, 'documents', 1 - i / 1000),
    );
    const capped = await retrieve(
      {
        readers: [stubReader({ keyword: [], dense: many })],
        embedder,
        orgSlug: 'acme',
      },
      { query: 'q', limit: 9999 },
    );
    expect(capped.hits.length).toBe(50);

    const floored = await retrieve(
      {
        readers: [stubReader({ keyword: [], dense: many })],
        embedder,
        orgSlug: 'acme',
      },
      { query: 'q', limit: 0 },
    );
    expect(floored.hits.length).toBe(1);
  });

  it('answers an empty query with nothing rather than searching', async () => {
    const reader = stubReader();
    const result = await retrieve(
      { readers: [reader], embedder, orgSlug: 'acme' },
      { query: '   ' },
    );
    expect(result.hits).toEqual([]);
    expect(reader.calls).toEqual([]);
  });
});

describe('reranking is off by default and never load-bearing', () => {
  it('does not rerank when nothing is installed', async () => {
    const result = await retrieve(
      { readers: [stubReader()], embedder, orgSlug: 'acme' },
      { query: 'holiday policy' },
    );
    expect(result.diagnostics.reranked).toBe(false);
    for (const entry of result.hits) expect(entry.rerankScore).toBeUndefined();
  });

  it('reorders the fused list when one is installed', async () => {
    const reranker: KnowledgeReranker = {
      name: 'stub',
      rerank: ({ candidates }) =>
        // Reverse what fusion decided, so the effect is unmistakable.
        Promise.resolve(
          candidates.toReversed().map((candidate, index) => ({
            id: candidate.id,
            score: 1 - index / 100,
          })),
        ),
    };
    setKnowledgeReranker(reranker);
    const result = await retrieve(
      { readers: [stubReader()], embedder, orgSlug: 'acme' },
      { query: 'holiday policy' },
    );
    expect(result.diagnostics.reranked).toBe(true);
    expect(result.hits.map((entry) => entry.id)).toEqual([
      'kw',
      'dense',
      'shared',
    ]);
    expect(result.hits[0].rerankScore).toBeDefined();
  });

  it('keeps the fused order when the reranker fails', async () => {
    setKnowledgeReranker({
      name: 'broken',
      rerank: () => Promise.reject(new Error('rerank service unreachable')),
    });
    const result = await retrieve(
      { readers: [stubReader()], embedder, orgSlug: 'acme' },
      { query: 'holiday policy' },
    );
    // A slightly worse ranking beats no answer.
    expect(result.hits.map((entry) => entry.id)).toEqual([
      'shared',
      'dense',
      'kw',
    ]);
    expect(result.diagnostics.reranked).toBe(false);
  });

  it('ignores results the reranker invented', async () => {
    // A remote scorer does not get to widen what the corpus query authorized.
    setKnowledgeReranker({
      name: 'inventive',
      rerank: () =>
        Promise.resolve([
          { id: 'documents:not-a-real-chunk', score: 9 },
          { id: 'documents:dense', score: 1 },
        ]),
    });
    const result = await retrieve(
      { readers: [stubReader()], embedder, orgSlug: 'acme' },
      { query: 'holiday policy' },
    );
    expect(result.hits.map((entry) => entry.id)).not.toContain(
      'not-a-real-chunk',
    );
    expect(result.hits[0].id).toBe('dense');
  });
});

describe('the semantic cache is off by default and never authoritative', () => {
  function recordingCache(
    stored: readonly import('./types').FusedKnowledgeHit[] | null,
  ): KnowledgeCache & { lookups: string[]; writes: string[] } {
    const lookups: string[] = [];
    const writes: string[] = [];
    return {
      name: 'stub',
      lookups,
      writes,
      lookup(key) {
        lookups.push(key.orgSlug);
        return Promise.resolve(stored);
      },
      store(key) {
        writes.push(key.orgSlug);
        return Promise.resolve();
      },
    };
  }

  it('does not consult anything when no cache is installed', async () => {
    const result = await retrieve(
      { readers: [stubReader()], embedder, orgSlug: 'acme' },
      { query: 'holiday policy' },
    );
    expect(result.diagnostics.cached).toBe(false);
  });

  it('answers from the cache and says so', async () => {
    const cache = recordingCache([
      {
        ...hit('cached', 'documents', 1),
        fusedScore: 1,
      },
    ]);
    setKnowledgeCache(cache);
    const result = await retrieve(
      { readers: [stubReader()], embedder, orgSlug: 'acme' },
      { query: 'holiday policy' },
    );
    expect(result.diagnostics.cached).toBe(true);
    expect(result.hits.map((entry) => entry.id)).toEqual(['cached']);
  });

  it('keys the cache by organization', async () => {
    const cache = recordingCache(null);
    setKnowledgeCache(cache);
    await retrieve(
      { readers: [stubReader()], embedder, orgSlug: 'acme' },
      { query: 'holiday policy' },
    );
    expect(cache.lookups).toEqual(['acme']);
    expect(cache.writes).toEqual(['acme']);
  });

  it('never caches a filtered search', async () => {
    // A cached answer cannot know which filter produced it.
    const cache = recordingCache(null);
    setKnowledgeCache(cache);
    await retrieve(
      { readers: [stubReader()], embedder, orgSlug: 'acme' },
      { query: 'holiday policy', folder: '/hr' },
    );
    expect(cache.lookups).toEqual([]);
    expect(cache.writes).toEqual([]);
  });

  it('searches the corpus when the cache throws', async () => {
    setKnowledgeCache({
      name: 'broken',
      lookup: () => Promise.reject(new Error('cache unreachable')),
      store: () => Promise.reject(new Error('cache unreachable')),
    });
    const result = await retrieve(
      { readers: [stubReader()], embedder, orgSlug: 'acme' },
      { query: 'holiday policy' },
    );
    expect(result.diagnostics.cached).toBe(false);
    expect(result.hits.length).toBeGreaterThan(0);
  });
});
