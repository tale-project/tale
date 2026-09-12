/**
 * Hybrid retrieval — the search itself, written against seams rather than
 * against a database.
 *
 * One search runs two legs over the corpus and fuses them:
 *
 *  - the KEYWORD leg (BM25) finds chunks that use the query's words, which is
 *    what wins for names, identifiers, error strings, and exact phrases;
 *  - the DENSE leg (vector similarity) finds chunks that mean what the query
 *    means, which is what wins for paraphrase and for questions worded nothing
 *    like the document.
 *
 * Neither leg is safe alone, so {@link fuseByRank} combines them by rank and
 * that is the DEFAULT — there is no "hybrid: true" to remember to switch on.
 *
 * Three behaviours here exist because their absence caused real failures, and
 * they are the reason the whole thing is written against a
 * {@link CorpusReader} seam instead of inline SQL:
 *
 *  - **BM25 is optional.** A bring-your-own Postgres — RDS, Neon, Cloud SQL —
 *    cannot install ParadeDB's `pg_search`. Retrieval must return the dense
 *    results on such a database, not an error; the keyword leg reports
 *    `unavailable` and the search continues single-legged. Fusion over one leg
 *    is that leg's own ranking, so no special case is needed downstream.
 *  - **A reranker is never load-bearing.** It is off unless installed, and a
 *    failing one degrades to the fused order instead of failing the search.
 *  - **A cache is never authoritative.** It is off unless installed, is
 *    consulted only for unfiltered searches, and is keyed per organization by
 *    contract.
 *
 * The organization is not a parameter here at all: a {@link CorpusReader} is
 * BOUND to one organization by whoever constructed it. That is deliberate —
 * an org id travelling as an argument through the retrieval logic is an org id
 * that can be forgotten in one branch, and the resulting cross-tenant read
 * would be invisible. Retrieval simply has no way to address another tenant's
 * corpus.
 */

import { knowledgeCache } from './cache';
import { dropRepeatedPassages } from './dedupe';
import { fuseByRank } from './fusion';
import { logger } from './logger';
import { knowledgeReranker, type RerankCandidate } from './rerank';
import {
  corporaFor,
  type FusedKnowledgeHit,
  type KnowledgeAccessScope,
  type KnowledgeCorpus,
  type KnowledgeHit,
  type KnowledgeQuery,
  type KnowledgeResult,
} from './types';

/** Hits returned when the caller names no limit. */
const DEFAULT_LIMIT = 10;

/** Hard ceiling on one search. The hits land in a model's context, so an
 * unbounded limit trades an answer for a truncation. */
const MAX_LIMIT = 50;

/**
 * How many candidates each leg fetches relative to the requested limit.
 *
 * Fusion can only reorder what it was given: if each leg returned exactly
 * `limit` rows, a chunk ranked 11th by both legs — a strong consensus result —
 * could never surface. Over-fetching is what lets agreement outrank a single
 * leg's confidence.
 */
const CANDIDATE_FACTOR = 3;

/**
 * The smallest candidate pool one search fuses, whatever the limit. The
 * admission re-check runs on this pool and can only thin it — a trashed
 * document's chunks, a file outside the caller's scope — so a page of one
 * must be chosen from enough candidates that a refused favourite does not
 * empty the page: `limit: 1` used to fetch three candidates, admit after
 * the cut, and answer nothing for a query that plainly matched.
 */
const MIN_CANDIDATES = 20;

/** How many candidates one search fuses for `limit` — the per-leg fetch and
 * the size of the pool the admission re-check sees. */
function candidatePool(limit: number): number {
  return Math.min(
    Math.max(limit * CANDIDATE_FACTOR, MIN_CANDIDATES),
    MAX_LIMIT * CANDIDATE_FACTOR,
  );
}

/** What one leg is asked for. */
export interface CorpusLegQuery {
  readonly query: string;
  readonly limit: number;
  readonly refs?: readonly string[];
  readonly folder?: string;
  /** The caller's document visibility. Absent = org-wide. */
  readonly access?: KnowledgeAccessScope;
}

/**
 * The corpus, as retrieval needs it — bound to ONE organization by its
 * constructor.
 *
 * Implementations are responsible for scoping every statement they issue to
 * that organization. The seam exists so the retrieval logic above can be tested
 * exhaustively without a database, and so a host that stores its corpus
 * somewhere else can serve the same searches.
 */
export interface CorpusReader {
  /** Which corpus this reader serves. */
  readonly corpus: Exclude<KnowledgeCorpus, 'all'>;
  /**
   * The keyword leg. Returns `null` — not an empty list — when the corpus has
   * no full-text index available, so the caller can tell "ran, matched
   * nothing" from "could not run" and report the degrade honestly.
   */
  keyword(query: CorpusLegQuery): Promise<readonly KnowledgeHit[] | null>;
  /** The dense leg. `embedding` is the query vector. */
  dense(
    query: CorpusLegQuery & { readonly embedding: readonly number[] },
  ): Promise<readonly KnowledgeHit[]>;
}

/** Turns the query text into a vector, using the organization's own explicitly
 * configured embedding model. */
export interface QueryEmbedder {
  embed(text: string): Promise<readonly number[]>;
}

export interface RetrieveDeps {
  /** One reader per corpus the search may touch. */
  readonly readers: readonly CorpusReader[];
  readonly embedder: QueryEmbedder;
  /** The organization the readers are bound to — used only to key the cache,
   * never to choose a corpus. */
  readonly orgSlug: string;
  /**
   * The admission re-check: which fused candidates the CALLER may be shown.
   * A host verifies each documents-corpus hit against its live document
   * here — lifecycle, completion, scope, folder — BEFORE the page is cut,
   * so a candidate it refuses costs the page nothing; the check ran after
   * the cut once, and a refused top candidate emptied a `limit: 1` page.
   * Must keep the order it is given. Absent admits everything (a corpus
   * whose rows are the truth).
   */
  readonly admit?: (
    hits: readonly FusedKnowledgeHit[],
  ) => Promise<readonly FusedKnowledgeHit[]>;
}

/**
 * Run one hybrid search.
 *
 * Returns the fused hits plus diagnostics describing how the answer was
 * produced, so a caller can distinguish a healthy empty result from a degraded
 * one without inspecting logs.
 */
export async function retrieve(
  deps: RetrieveDeps,
  query: KnowledgeQuery,
): Promise<KnowledgeResult> {
  const text = query.query.trim();
  const nothing: KnowledgeResult = {
    hits: [],
    diagnostics: {
      bm25: true,
      reranked: false,
      cached: false,
      admitted: 0,
      legs: {},
    },
  };
  if (text === '') return nothing;

  const limit = clampLimit(query.limit);
  const corpus = query.corpus ?? 'all';
  const wanted = new Set<string>(corporaFor(corpus));
  const readers = deps.readers.filter((reader) => wanted.has(reader.corpus));
  if (readers.length === 0) return nothing;
  const admit = deps.admit ?? admitEverything;

  const embedding = await deps.embedder.embed(text);

  // A cached answer cannot know which filter produced it, so a filtered search
  // never reads or writes the cache. An access scope IS a filter — a cached
  // answer computed under one caller's visibility must never serve a caller
  // with a different one, in either direction — so an access-scoped search
  // bypasses the cache the same way. Only org-wide searches are cacheable.
  const filtered =
    (query.refs !== undefined && query.refs.length > 0) ||
    query.folder !== undefined ||
    query.access !== undefined;
  const cache = filtered ? null : knowledgeCache();
  const cacheKey = {
    orgSlug: deps.orgSlug,
    query: text,
    embedding,
    corpus,
  };

  if (cache) {
    const hit = await cache.lookup(cacheKey).catch((err: unknown): null => {
      logger.warn(
        `semantic cache "${cache.name}" lookup failed, searching the corpus: ${describe(err)}`,
      );
      return null;
    });
    if (hit) {
      // A cached pool can outlive a document — admission decides again on
      // the caller's live truth, then the page is cut exactly as for a
      // fresh search.
      const kept = await admit(hit);
      return {
        hits: dropRepeatedPassages(kept).slice(0, limit),
        diagnostics: {
          bm25: true,
          reranked: false,
          cached: true,
          admitted: kept.length,
          legs: { cache: hit.length },
        },
      };
    }
  }

  const reranker = knowledgeReranker();
  const pool = candidatePool(limit);
  const legQuery: CorpusLegQuery = {
    query: text,
    limit: pool,
    ...(query.refs !== undefined && { refs: query.refs }),
    ...(query.folder !== undefined && { folder: query.folder }),
    ...(query.access !== undefined && { access: query.access }),
  };

  const legs: Record<string, number> = {};
  const rankings: KnowledgeHit[][] = [];
  let bm25 = true;

  for (const reader of readers) {
    const [keyword, dense] = await Promise.all([
      reader.keyword(legQuery),
      reader.dense({ ...legQuery, embedding }),
    ]);

    if (keyword === null) {
      // The database has no full-text index. Vector-only is a worse search, but
      // it is a search; erroring here would make every managed Postgres
      // deployment unable to retrieve at all.
      bm25 = false;
      logger.debug(
        `no full-text index on the ${reader.corpus} corpus — searching dense-only`,
      );
    } else if (keyword.length > 0) {
      legs[`${reader.corpus}:keyword`] = keyword.length;
      rankings.push([...keyword]);
    }

    const floor = query.minSimilarity;
    const kept =
      floor === undefined ? dense : dense.filter((hit) => hit.score >= floor);
    if (kept.length > 0) {
      legs[`${reader.corpus}:dense`] = kept.length;
      rankings.push([...kept]);
    }
  }

  if (rankings.length === 0) {
    return {
      hits: [],
      diagnostics: { bm25, reranked: false, cached: false, admitted: 0, legs },
    };
  }

  // The whole candidate pool is fused, then ADMITTED, then deduplicated —
  // and only then reranked and cut to `limit`, so what the caller cannot
  // see never occupies a slot on the page it gets.
  const fused = fuseByRank(rankings, (hit) => `${hit.corpus}:${hit.id}`, {
    limit: pool,
  });
  // Built with a loop and `Object.assign` rather than map-and-spread: the
  // assign writes into a fresh target, so the fused entry's own item is left
  // untouched.
  const candidates: FusedKnowledgeHit[] = [];
  for (const entry of fused) {
    candidates.push(
      Object.assign({ fusedScore: entry.score, legs: entry.legs }, entry.item, {
        fusedScore: entry.score,
        legs: entry.legs,
      }),
    );
  }
  const kept = await admit(candidates);
  let hits = dropRepeatedPassages(kept);

  // The cache keeps the admitted pool in fused order — spare candidates for
  // a later lookup, which admits again on its own live truth.
  if (cache && hits.length > 0) {
    await cache.store(cacheKey, hits).catch((err: unknown) => {
      logger.warn(
        `semantic cache "${cache.name}" store failed, the search still answered: ${describe(err)}`,
      );
    });
  }

  let reranked = false;
  if (reranker && hits.length > 0) {
    const applied = await applyRerank(
      reranker.name,
      hits,
      text,
      limit,
      reranker,
    );
    if (applied !== null) {
      hits = applied;
      reranked = true;
    }
  }
  hits = hits.slice(0, limit);

  return {
    hits,
    diagnostics: { bm25, reranked, cached: false, admitted: kept.length, legs },
  };
}

function admitEverything(
  hits: readonly FusedKnowledgeHit[],
): Promise<readonly FusedKnowledgeHit[]> {
  return Promise.resolve(hits);
}

/**
 * Reorder the fused hits with the installed reranker.
 *
 * Returns `null` when the reranker fails or returns nothing usable — the caller
 * then keeps the fused order, because a fused ranking is a good answer and a
 * failed search is not one. Ids the reranker invents are dropped rather than
 * looked up: the corpus query decided what this caller may see, and a remote
 * scorer does not get to widen that.
 */
async function applyRerank(
  name: string,
  hits: readonly FusedKnowledgeHit[],
  query: string,
  topK: number,
  reranker: {
    rerank(args: {
      query: string;
      candidates: readonly RerankCandidate[];
      topK: number;
    }): Promise<readonly { id: string; score: number }[]>;
  },
): Promise<FusedKnowledgeHit[] | null> {
  const byId = new Map<string, FusedKnowledgeHit>();
  const candidates: RerankCandidate[] = [];
  for (const hit of hits) {
    const id = `${hit.corpus}:${hit.id}`;
    byId.set(id, hit);
    candidates.push({ id, text: hit.text });
  }

  let scored: readonly { id: string; score: number }[];
  try {
    scored = await reranker.rerank({ query, candidates, topK });
  } catch (err) {
    logger.warn(
      `reranker "${name}" failed, keeping the fused ranking: ${describe(err)}`,
    );
    return null;
  }

  const ordered: FusedKnowledgeHit[] = [];
  const seen = new Set<string>();
  for (const entry of scored) {
    const hit = byId.get(entry.id);
    if (hit === undefined || seen.has(entry.id)) continue;
    seen.add(entry.id);
    ordered.push({ ...hit, rerankScore: entry.score });
  }
  if (ordered.length === 0) {
    logger.warn(
      `reranker "${name}" returned no known candidates, keeping the fused ranking`,
    );
    return null;
  }
  // A reranker asked for the top K may legitimately return fewer than it was
  // given; the remaining fused hits keep their relative order behind them.
  for (const hit of hits) {
    if (!seen.has(`${hit.corpus}:${hit.id}`)) ordered.push(hit);
  }
  return ordered;
}

/** Keep one search's result set inside the bounds a context window can hold. */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.floor(limit), MAX_LIMIT));
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
