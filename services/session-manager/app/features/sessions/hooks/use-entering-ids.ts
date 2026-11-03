import { useLayoutEffect, useRef, useState } from 'react';

const NONE: ReadonlySet<number> = new Set();

/**
 * More rows than this arriving at once is a list filling (a page loaded, the
 * connection back), not news: they appear without dropping in one by one.
 */
const MAX_ENTERING = 3;

/**
 * The sessions that just joined an open list, a session the person added, so
 * their rows can drop into place instead of appearing. The first rows of a
 * list, and a page of older ones, announce nothing.
 *
 * Decided in a layout effect, so the class lands before the new row's first
 * paint and its entrance plays from the start.
 */
export function useEnteringIds(
  ids: readonly number[],
  /** While the first answer is awaited, nothing counts as arriving. */
  loading: boolean,
): ReadonlySet<number> {
  const [entering, setEntering] = useState<ReadonlySet<number>>(NONE);
  const seen = useRef<ReadonlySet<number> | null>(null);

  useLayoutEffect(() => {
    const previous = seen.current;
    seen.current = loading ? null : new Set(ids);
    if (loading || previous === null) return;
    const added = ids.filter((id) => !previous.has(id));
    if (added.length > 0 && added.length <= MAX_ENTERING) {
      setEntering(new Set(added));
    }
  }, [ids, loading]);

  return entering;
}
