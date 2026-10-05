import { startTransition, useEffect, useState } from 'react';

/**
 * A long list's first screens now, the rest in an interruptible background
 * render right after. A task's discussion or history can hold hundreds of
 * rows, each a parsed markdown body or a resolved line, and mounting them all
 * in the frame that opens the task kept it from opening. The list answers
 * `items.slice(0, firstFrame)` while more are waiting, whether they were there
 * at mount or arrived later, and every item once the background render has
 * committed. A transition yields to input, so typing and closing stay
 * responsive while it runs.
 */
export function useFirstFrameSlice<T>(
  items: readonly T[],
  firstFrame: number,
): readonly T[] {
  const [limit, setLimit] = useState(firstFrame);
  const waiting = items.length > limit;
  useEffect(() => {
    if (!waiting) return;
    startTransition(() => setLimit(Number.POSITIVE_INFINITY));
  }, [waiting]);
  return waiting ? items.slice(0, limit) : items;
}
