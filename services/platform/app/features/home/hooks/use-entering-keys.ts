'use client';

import { useLayoutEffect, useRef, useState } from 'react';

const NONE: ReadonlySet<string> = new Set();

/** More rows than this arriving at once is a list refilling (a reconnect, a
 * page loaded), not news — it enters without a stagger of slides. */
const MAX_ENTERING = 4;

/**
 * The rows that just joined a list while it was open — a chat you started, a
 * task handed to you, a conversation that came in — so they can slide in
 * instead of appearing. The first paint of a list, and a list swapped for
 * another (a new view, a new status), announce nothing: those fade as a
 * whole.
 *
 * Decided in a layout effect, so the class lands before the new row's first
 * paint and its entrance plays from the start.
 */
export function useEnteringKeys(
  keys: readonly string[],
  /** Changes when the list is swapped for another rather than updated. */
  listIdentity: string,
  /** While the list is still loading nothing counts as arriving. */
  loading: boolean,
): ReadonlySet<string> {
  const [entering, setEntering] = useState<ReadonlySet<string>>(NONE);
  const seen = useRef<{ identity: string; keys: ReadonlySet<string> } | null>(
    null,
  );
  const signature = keys.join('\n');

  useLayoutEffect(() => {
    const previous = seen.current;
    const current = new Set(keys);
    seen.current = loading ? null : { identity: listIdentity, keys: current };
    if (loading || previous === null || previous.identity !== listIdentity) {
      setEntering(NONE);
      return;
    }
    const added = keys.filter((key) => !previous.keys.has(key));
    if (added.length > 0 && added.length <= MAX_ENTERING) {
      setEntering(new Set(added));
    }
    // `keys` is read through its signature: a new array with the same rows
    // is not a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, listIdentity, loading]);

  return entering;
}
