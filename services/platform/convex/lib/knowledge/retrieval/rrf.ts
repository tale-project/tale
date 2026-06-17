/**
 * Reciprocal Rank Fusion (RRF) for merging ranked search results.
 *
 * Pure function — no database or service dependencies. Both services provide
 * their own result types; RRF operates on records carrying an id field.
 */

export const RRF_K = 60;

export interface RrfResult {
  rrf_score: number;
  [key: string]: unknown;
}

export interface MergeRrfOptions {
  /** Key to use as the unique identifier in result records. Defaults to `id`. */
  idKey?: string;
  /** RRF constant (default 60). */
  k?: number;
}

/**
 * Merge multiple ranked lists using Reciprocal Rank Fusion.
 *
 * @param rankedLists Ranked result lists (each item must carry `idKey`).
 * @param limit Maximum number of results to return.
 * @returns Merged records with an added normalized `rrf_score`, sorted by score.
 */
export function mergeRrf<T extends Record<string, unknown>>(
  rankedLists: T[][],
  limit: number,
  options: MergeRrfOptions = {},
): (T & RrfResult)[] {
  const idKey = options.idKey ?? 'id';
  const k = options.k ?? RRF_K;

  if (k < 1) {
    throw new Error(`RRF constant k must be >= 1, got ${k}`);
  }
  if (limit < 0) {
    throw new Error(`limit must be >= 0, got ${limit}`);
  }

  const scores = new Map<unknown, number>();
  const items = new Map<unknown, T>();

  for (const ranked of rankedLists) {
    for (let rank = 0; rank < ranked.length; rank += 1) {
      const item = ranked[rank];
      const itemId = item[idKey];
      const rrfScore = 1.0 / (k + rank + 1);
      scores.set(itemId, (scores.get(itemId) ?? 0.0) + rrfScore);
      items.set(itemId, item);
    }
  }

  const sortedIds = [...scores.keys()]
    .sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0))
    .slice(0, limit);

  const numContributing = Math.max(
    1,
    rankedLists.reduce((acc, list) => acc + (list.length > 0 ? 1 : 0), 0),
  );
  const maxScore = sortedIds.length > 0 ? numContributing / (k + 1) : 1.0;

  const merged: (T & RrfResult)[] = [];
  for (const itemId of sortedIds) {
    const base = items.get(itemId);
    if (base === undefined) {
      throw new Error(
        'RRF internal invariant violated: missing item for scored id',
      );
    }
    // Copy onto a fresh object (no `map` + spread, which the no-map-spread
    // rule flags); `Object.assign` writes into the new target, leaving the
    // map's stored item untouched. The target seeds `rrf_score` so the result
    // is statically a `T & RrfResult` without an assertion.
    const copy: T & RrfResult = Object.assign(
      { rrf_score: (scores.get(itemId) ?? 0) / maxScore },
      base,
    );
    copy.rrf_score = (scores.get(itemId) ?? 0) / maxScore;
    merged.push(copy);
  }
  return merged;
}
