import { describe, expect, it } from 'vitest';

import {
  retrieve,
  type CorpusLegQuery,
  type CorpusReader,
  type QueryEmbedder,
} from './retrieve';
import type { KnowledgeCorpus, KnowledgeHit } from './types';

/**
 * Retrieval is tested against stub corpus readers rather than a database: the
 * behaviour that matters most is what happens when a leg is UNAVAILABLE,
 * which a live ParadeDB would not let us provoke reliably.
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
  /** `null` models a corpus that cannot serve the vector leg. */
  dense?: readonly KnowledgeHit[] | null;
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
        options.dense === undefined
          ? [hit('dense', corpus, 0.9), hit('shared', corpus, 0.7)]
          : options.dense,
      );
    },
  };
}

describe('hybrid search is the default', () => {
  it('runs both legs and fuses them without being asked to', () => {
    return retrieve(
      { readers: [stubReader()], embedder },
      { query: 'holiday policy' },
    ).then((result) => {
      // The result both legs found outranks each leg's own favourite, and
      // nothing in the query switched fusion on. The two single-leg results
      // tie on score, so the deterministic tie-break puts the keyword-ranked
      // one first — an exact term over a nearest neighbour.
      expect(result.hits.map((entry) => entry.id)).toEqual([
        'shared',
        'kw',
        'dense',
      ]);
      expect(result.diagnostics.bm25).toBe(true);
      expect(result.diagnostics.reranked).toBe(false);
      expect(result.diagnostics.cached).toBe(false);
    });
  });

  it('over-fetches per leg so agreement can outrank a single leg, never below the admission floor', async () => {
    // Three candidates per requested hit, and at least twenty: a page of one
    // is chosen from a pool the admission re-check can thin without
    // emptying it.
    const small = stubReader();
    await retrieve(
      { readers: [small], embedder },
      { query: 'holiday policy', limit: 5 },
    );
    for (const call of small.calls) expect(call.limit).toBe(20);
    const large = stubReader();
    await retrieve(
      { readers: [large], embedder },
      { query: 'holiday policy', limit: 10 },
    );
    for (const call of large.calls) expect(call.limit).toBe(30);
  });

  it('marks how many legs agreed on each hit', async () => {
    const result = await retrieve(
      { readers: [stubReader()], embedder },
      { query: 'holiday policy' },
    );
    expect(result.hits.map((entry) => [entry.id, entry.legs])).toEqual([
      ['shared', 2],
      ['kw', 1],
      ['dense', 1],
    ]);
    expect(result.diagnostics.admitted).toBe(3);
  });

  it('searches both corpora when none is named', async () => {
    const documents = stubReader({ corpus: 'documents' });
    const web = stubReader({ corpus: 'web' });
    const result = await retrieve(
      { readers: [documents, web], embedder },
      { query: 'holiday policy' },
    );
    const corpora = new Set(result.hits.map((entry) => entry.corpus));
    expect(corpora).toEqual(new Set(['documents', 'web']));
  });

  it('searches only the named corpus', async () => {
    const documents = stubReader({ corpus: 'documents' });
    const web = stubReader({ corpus: 'web' });
    const result = await retrieve(
      { readers: [documents, web], embedder },
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
      { readers: [stubReader({ keyword: null })], embedder },
      { query: 'holiday policy' },
    );
    expect(result.hits.map((entry) => entry.id)).toEqual(['dense', 'shared']);
    expect(result.diagnostics.bm25).toBe(false);
  });

  it('reports a healthy search that matched nothing as healthy, naming the leg with its zero', async () => {
    // An empty keyword list is not the same as a missing index, and a caller
    // that cannot tell them apart cannot report the difference either. The
    // leg that ran is in `legs` with its `0`: a missing key used to be the
    // only sign of a leg that found nothing, indistinguishable from one that
    // never ran (2026-09-14 evaluation, h4).
    const result = await retrieve(
      { readers: [stubReader({ keyword: [] })], embedder },
      { query: 'holiday policy' },
    );
    expect(result.diagnostics.bm25).toBe(true);
    expect(result.diagnostics.dense).toBe(true);
    expect(result.diagnostics.legs).toEqual({
      'documents:keyword': 0,
      'documents:dense': 2,
    });
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it('returns nothing, without failing, when both legs are empty', async () => {
    const result = await retrieve(
      {
        readers: [stubReader({ keyword: [], dense: [] })],
        embedder,
      },
      { query: 'holiday policy' },
    );
    expect(result.hits).toEqual([]);
    expect(result.diagnostics.legs).toEqual({
      'documents:keyword': 0,
      'documents:dense': 0,
    });
  });

  it('reports a corpus that cannot serve the vector leg as dense: false and searches keyword-only', async () => {
    const result = await retrieve(
      { readers: [stubReader({ dense: null })], embedder },
      { query: 'holiday policy' },
    );
    expect(result.diagnostics.dense).toBe(false);
    expect(result.diagnostics.bm25).toBe(true);
    expect(result.diagnostics.legs).toEqual({ 'documents:keyword': 2 });
    expect(result.hits.map((entry) => entry.id)).toEqual(['kw', 'shared']);
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
      },
      { query: 'holiday policy', minSimilarity: 0.5 },
    );
    expect(result.hits.map((entry) => entry.id)).toEqual(['near']);
  });

  it('passes the document and folder restrictions to both legs', async () => {
    const reader = stubReader();
    await retrieve(
      { readers: [reader], embedder },
      { query: 'holiday policy', refs: ['a', 'b'], folder: '/hr' },
    );
    for (const call of reader.calls) {
      expect(call.refs).toEqual(['a', 'b']);
      expect(call.folder).toBe('/hr');
    }
  });

  it("passes the caller's access scope to both legs", async () => {
    // The scope decides which documents this caller may see at all, so a leg
    // that missed it would leak scoped documents — both legs must carry it.
    const reader = stubReader();
    const access = {
      teamIds: ['team-a'],
      projectIds: ['proj-1'],
      includeHub: true,
    };
    await retrieve(
      { readers: [reader], embedder },
      { query: 'holiday policy', access },
    );
    expect(reader.calls.length).toBeGreaterThan(0);
    for (const call of reader.calls) {
      expect(call.access).toEqual(access);
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
      },
      { query: 'q', limit: 9999 },
    );
    expect(capped.hits.length).toBe(50);

    const floored = await retrieve(
      {
        readers: [stubReader({ keyword: [], dense: many })],
        embedder,
      },
      { query: 'q', limit: 0 },
    );
    expect(floored.hits.length).toBe(1);
  });

  it('answers an empty query with nothing rather than searching', async () => {
    const reader = stubReader();
    const result = await retrieve(
      { readers: [reader], embedder },
      { query: '   ' },
    );
    expect(result.hits).toEqual([]);
    expect(reader.calls).toEqual([]);
  });
});

/**
 * Admission — the host's live-document re-check — runs on the whole fused
 * pool BEFORE the page is cut. The regression under test: the page was cut
 * to `limit` first and checked after, so a `limit: 1` search whose best
 * candidate had just been trashed answered nothing for a query that
 * plainly matched.
 */
describe('admission runs before the page is cut', () => {
  const refuse =
    (...ids: string[]) =>
    <Hit extends KnowledgeHit>(hits: readonly Hit[]) =>
      Promise.resolve(hits.filter((entry) => !ids.includes(entry.id)));

  it('admits BEFORE fusing, so a refused candidate never holds a rank', async () => {
    // With fusion first, `top` held rank 1 in both legs and `next` was
    // scored as rank 2 — 0.98 of the best — while a caller who could not
    // see `top` was told the page's only hit was second-best. Admission
    // now runs on the raw leg lists: `next` IS the best admitted candidate
    // and scores 1, and the legs report what was actually fused.
    const reader = stubReader({
      keyword: [hit('top', 'documents', 12), hit('next', 'documents', 8)],
      dense: [hit('top', 'documents', 0.9), hit('next', 'documents', 0.7)],
    });
    const admitted: string[][] = [];
    const result = await retrieve(
      {
        readers: [reader],
        embedder,
        admit: (hits) => {
          admitted.push(hits.map((entry) => entry.id));
          return refuse('top')(hits);
        },
      },
      { query: 'q', limit: 5 },
    );
    // One check over the distinct candidates of every leg — not one per leg.
    expect(admitted).toEqual([['top', 'next']]);
    expect(result.hits.map((entry) => [entry.id, entry.fusedScore])).toEqual([
      ['next', 1],
    ]);
    expect(result.diagnostics.legs).toEqual({
      'documents:keyword': 1,
      'documents:dense': 1,
    });
    expect(result.diagnostics.admitted).toBe(1);
  });

  it('names the legs that ranked each hit and carries their own scores beside the rank key', async () => {
    const reader = stubReader({
      keyword: [hit('kw', 'documents', 12), hit('shared', 'documents', 8)],
      dense: [hit('dense', 'documents', 0.9), hit('shared', 'documents', 0.7)],
    });
    const result = await retrieve(
      { readers: [reader], embedder },
      { query: 'q' },
    );
    const byId = new Map(result.hits.map((entry) => [entry.id, entry]));
    expect(byId.get('shared')).toMatchObject({
      legs: 2,
      matchedLegs: ['documents:keyword', 'documents:dense'],
      similarity: 0.7,
      keywordScore: 8,
      // The surviving object is the keyword leg's copy — unchanged.
      score: 8,
    });
    expect(byId.get('kw')).toMatchObject({
      legs: 1,
      matchedLegs: ['documents:keyword'],
      similarity: null,
      keywordScore: 12,
    });
    expect(byId.get('dense')).toMatchObject({
      legs: 1,
      matchedLegs: ['documents:dense'],
      similarity: 0.9,
      keywordScore: null,
    });
  });

  it('a refused top candidate does not empty a limit:1 page', async () => {
    const reader = stubReader({
      keyword: [hit('top', 'documents', 12), hit('next', 'documents', 8)],
      dense: [hit('top', 'documents', 0.9), hit('next', 'documents', 0.7)],
    });
    const result = await retrieve(
      { readers: [reader], embedder, admit: refuse('top') },
      { query: 'q', limit: 1 },
    );
    expect(result.hits.map((entry) => entry.id)).toEqual(['next']);
    expect(result.diagnostics.admitted).toBe(1);
  });

  it('hits at limit 1 are a prefix of hits at limit 3', async () => {
    const legs = () =>
      stubReader({
        keyword: [
          hit('a', 'documents', 12),
          hit('b', 'documents', 10),
          hit('c', 'documents', 8),
          hit('d', 'documents', 6),
        ],
        dense: [
          hit('a', 'documents', 0.9),
          hit('c', 'documents', 0.8),
          hit('b', 'documents', 0.7),
        ],
      });
    const one = await retrieve(
      { readers: [legs()], embedder, admit: refuse('a') },
      { query: 'q', limit: 1 },
    );
    const three = await retrieve(
      { readers: [legs()], embedder, admit: refuse('a') },
      { query: 'q', limit: 3 },
    );
    expect(three.hits.map((entry) => entry.id)).toEqual(['b', 'c', 'd']);
    expect(one.hits.map((entry) => entry.id)).toEqual(
      three.hits.map((entry) => entry.id).slice(0, 1),
    );
  });

  it('drops a repeated passage after admission, so the readable copy survives', async () => {
    // Deduping before the re-check could keep an unreadable copy and drop
    // the readable one; the re-check would then remove what was kept.
    const copy = (id: string, score: number) => ({
      ...hit(id, 'documents', score),
      text: 'Refunds within 30 days.',
    });
    const reader = stubReader({
      keyword: [copy('copy_a', 12), copy('copy_b', 8)],
      dense: [],
    });
    const result = await retrieve(
      {
        readers: [reader],
        embedder,
        admit: refuse('copy_a'),
      },
      { query: 'refunds' },
    );
    expect(result.hits.map((entry) => entry.id)).toEqual(['copy_b']);
  });
});
