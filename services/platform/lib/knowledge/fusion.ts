/**
 * Reciprocal Rank Fusion — how a keyword ranking and a vector ranking become
 * one ranking.
 *
 * The two retrieval legs answer different questions. BM25 finds documents that
 * use the query's words; a dense vector search finds documents that mean what
 * the query means. Their scores are not comparable — a BM25 score of 14 and a
 * cosine similarity of 0.82 say nothing about each other — so they cannot be
 * added, averaged, or thresholded against one another. What IS comparable is
 * the POSITION a leg put a result in.
 *
 * RRF scores each result by `1 / (k + rank)` summed over the legs that returned
 * it. A result both legs rank highly wins; a result only one leg found still
 * places, weighted by how confidently that leg ranked it. This is why fusion is
 * the default rather than an option: across the measured cases it is never the
 * worst of the three strategies, whereas keyword-only and vector-only each lose
 * badly on the queries suited to the other. A single-leg fusion is exactly that
 * leg's ranking, so the code path does not change when one leg is unavailable.
 *
 * `k` damps the top of each list: with `k = 60` the difference between rank 1
 * and rank 2 is small enough that one leg's confident mistake cannot outvote
 * the other leg's agreement.
 *
 * What the fused score IS — and is not. It is a rank: the best candidate of a
 * one-leg search scores 1.0 however weak that leg found it, and a candidate's
 * score moves when its neighbours do. It is never a confidence. The legs' own
 * scores — a cosine, a BM25 weight — travel beside it in `sources`, per leg,
 * so a caller that needs to threshold thresholds on those.
 *
 * Pure: no database, no scores from outside the ranking, no clock.
 */

/** The damping constant. 60 is the value the original RRF work reports and the
 * one the measured comparisons here were run against. */
export const RRF_K = 60;

export interface FuseOptions {
  /** Maximum results to return. */
  readonly limit: number;
  /** Damping constant; must be at least 1. */
  readonly k?: number;
  /** A name per input list, in order — what `sources[].leg` reports. A list
   * without a name is `leg-<n>` (1-based). */
  readonly legs?: readonly string[];
}

/** One leg's own account of an item: where it ranked it and what it scored
 * it — the leg's copy, so a keyword leg reports its BM25 weight and a dense
 * leg its cosine even when the surviving object came from the other leg. */
export interface FusedSource {
  readonly leg: string;
  /** 1-based position in that leg's ranking. */
  readonly rank: number;
  /** That leg's own relevance score for the item. */
  readonly score: number;
}

export interface FusedItem<T> {
  readonly item: T;
  /** Summed reciprocal ranks, normalized so a result every leg ranked first
   * scores 1. Comparable across items of ONE fusion; the legs' own scores
   * are not. A rank, not a confidence: a single candidate scores 1. */
  readonly score: number;
  /** How many legs returned this item — the signal that makes agreement
   * visible to a caller. */
  readonly legs: number;
  /** Each leg that returned the item, with its rank and score there, in
   * input-list order. */
  readonly sources: readonly FusedSource[];
}

/**
 * Fuse ranked lists into one ranking.
 *
 * `identify` maps an item to the identity two legs would agree on (a chunk row
 * id). The first leg to return an item supplies the object that survives, so
 * callers should put the leg with the richer row first if the shapes differ;
 * every leg's own rank and score of the item is kept in `sources` regardless.
 * Ties are broken by the identity so the order is deterministic — a fused
 * ranking that reshuffles between two identical calls would make every
 * downstream snapshot flaky.
 */
export function fuseByRank<T extends { readonly score: number }>(
  lists: readonly (readonly T[])[],
  identify: (item: T) => string,
  options: FuseOptions,
): FusedItem<T>[] {
  const k = options.k ?? RRF_K;
  if (k < 1) throw new Error(`RRF k must be at least 1, got ${k}`);
  if (options.limit < 0) {
    throw new Error(`limit must not be negative, got ${options.limit}`);
  }

  const scores = new Map<string, number>();
  const sources = new Map<string, FusedSource[]>();
  const items = new Map<string, T>();

  for (const [index, list] of lists.entries()) {
    const leg = options.legs?.[index] ?? `leg-${index + 1}`;
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const id = identify(item);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
      const seen = sources.get(id) ?? [];
      seen.push({ leg, rank: rank + 1, score: item.score });
      sources.set(id, seen);
      if (!items.has(id)) items.set(id, item);
    }
  }

  // Normalize by the best score achievable given how many legs actually
  // returned anything, so an empty leg does not halve every score and a
  // caller's threshold keeps meaning the same thing.
  let contributing = 0;
  for (const list of lists) if (list.length > 0) contributing++;
  const best = Math.max(contributing, 1) / (k + 1);

  const ids = [...scores.keys()].sort((a, b) => {
    const delta = (scores.get(b) ?? 0) - (scores.get(a) ?? 0);
    return delta !== 0 ? delta : a.localeCompare(b);
  });

  const fused: FusedItem<T>[] = [];
  for (const id of ids.slice(0, options.limit)) {
    const item = items.get(id);
    // Every scored id was inserted into `items` in the same iteration, so this
    // cannot happen; refusing beats emitting a hit with no content.
    if (item === undefined) {
      throw new Error(`fusion lost the item behind scored id "${id}"`);
    }
    const from = sources.get(id) ?? [];
    fused.push({
      item,
      score: (scores.get(id) ?? 0) / best,
      legs: from.length,
      sources: from,
    });
  }
  return fused;
}
