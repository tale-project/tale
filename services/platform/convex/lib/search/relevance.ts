import type { Doc, TableNames } from '../../_generated/dataModel';
import type { SearchStrategy } from './types';

/** A row is "active" unless an explicit `lifecycleStatus` says otherwise.
 *  Rows missing the field (legacy / other tables) are treated as active.
 *  Reads loosely so any `Doc<T>` can be passed without per-table narrowing. */
export function isActiveRow(row: Record<string, unknown>): boolean {
  const status = row.lifecycleStatus;
  return (typeof status === 'string' ? status : 'active') === 'active';
}

/** Lowercased text for a searchable primitive field value. Strings and numbers
 *  are searchable; booleans, objects and arrays are not — ignoring them avoids
 *  both `[object Object]` matches and a boolean field accidentally matching the
 *  term "true"/"false". */
function fieldText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.toLowerCase();
  if (typeof value === 'number') return value.toString().toLowerCase();
  return undefined;
}

/** True when the row matches `lowerTerm` on any configured field. */
export function rowMatches<T extends TableNames>(
  row: Doc<T>,
  strategy: SearchStrategy<T>,
  lowerTerm: string,
  rawTerm: string,
): boolean {
  if (!lowerTerm) return true;
  const record = row as Record<string, unknown>;

  for (const field of strategy.textFields) {
    if (fieldText(record[field])?.includes(lowerTerm)) return true;
  }
  for (const field of strategy.arrayTextFields ?? []) {
    const arr = record[field];
    if (
      Array.isArray(arr) &&
      arr.some((el) => fieldText(el)?.includes(lowerTerm))
    ) {
      return true;
    }
  }
  for (const field of strategy.idFields ?? []) {
    const value = record[field];
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = value.toString();
    if (text === rawTerm || text.toLowerCase().includes(lowerTerm)) return true;
  }
  return false;
}

/** Rank a single row: exact field match (2) > prefix (1) > substring (0),
 *  taking the strongest signal across `textFields`. Matches via `idFields` or
 *  `arrayTextFields` aren't ranked here — they land in the substring tier (0)
 *  by design, so a name prefix outranks an incidental id/array hit. */
function rowScore<T extends TableNames>(
  row: Doc<T>,
  strategy: SearchStrategy<T>,
  lowerTerm: string,
): number {
  const record = row as Record<string, unknown>;
  let best = 0;
  for (const field of strategy.textFields) {
    const text = fieldText(record[field]);
    if (!text) continue;
    if (text === lowerTerm) return 2;
    if (text.startsWith(lowerTerm)) best = Math.max(best, 1);
  }
  return best;
}

/**
 * Order matched rows by relevance — strongest match first, then newest. Pure,
 * **page-local** sort: the caller has already paginated over the stable index
 * order, so re-ordering within the page keeps opaque cursors valid across
 * `loadMore`.
 */
export function scoreAndSort<T extends TableNames>(
  rows: ReadonlyArray<Doc<T>>,
  strategy: SearchStrategy<T>,
  lowerTerm: string,
): Doc<T>[] {
  return [...rows].sort((a, b) => {
    const byScore =
      rowScore(b, strategy, lowerTerm) - rowScore(a, strategy, lowerTerm);
    if (byScore !== 0) return byScore;
    return b._creationTime - a._creationTime;
  });
}
