/**
 * Reciprocal Rank Fusion (RRF)
 *
 * Merges ranked results from multiple search methods (vector + full-text)
 * into a single ranked list. Standard constant k=60.
 */

const RRF_K = 60;

interface RankedItem {
  id: string;
}

export function mergeWithRRF<T extends RankedItem>(
  rankedLists: T[][],
  limit: number,
): Array<T & { score: number }> {
  const scores = new Map<string, number>();
  const items = new Map<string, T>();

  for (const list of rankedLists) {
    for (const [rank, item] of list.entries()) {
      const rrfScore = 1 / (RRF_K + rank + 1);
      scores.set(item.id, (scores.get(item.id) ?? 0) + rrfScore);
      if (!items.has(item.id)) {
        items.set(item.id, item);
      }
    }
  }

  const results: Array<T & { score: number }> = [];
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  for (const [id, score] of sorted.slice(0, limit)) {
    const item = items.get(id);
    if (item) {
      results.push({ ...item, score });
    }
  }
  return results;
}
