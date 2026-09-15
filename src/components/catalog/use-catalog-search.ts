import { useMemo } from 'react';

/**
 * The one catalog search behaviour: trim + lowercase + substring match over
 * each item's haystack strings. Every catalog filters with this hook so the
 * matching semantics can't drift between surfaces.
 *
 * `getHaystack` must be referentially stable (a module-level function or a
 * `useCallback`) — it participates in the memo's dependency list.
 */
export function useCatalogSearch<T>(
  items: readonly T[],
  query: string,
  getHaystack: (item: T) => ReadonlyArray<string | undefined>,
): T[] {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...items];
    return items.filter((item) =>
      getHaystack(item).some((s) => s?.toLowerCase().includes(q)),
    );
  }, [items, query, getHaystack]);
}
