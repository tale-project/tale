import { useLayoutEffect, useState, type RefObject } from 'react';

import {
  computeMentionPopoverPlacement,
  type MentionPopoverCoords,
} from '../lib/mention-popover-position';

/**
 * Track a composer's on-screen box while the `@`-mention picker is open so the
 * popover can render in a body portal with `position: fixed` (avoids clipping
 * inside dialog scroll regions) and auto-flip above/below.
 */
export function useMentionPopoverPosition(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
): MentionPopoverCoords | null {
  const [coords, setCoords] = useState<MentionPopoverCoords | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return undefined;
    }

    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      setCoords(
        computeMentionPopoverPlacement(
          anchor.getBoundingClientRect(),
          window.innerHeight,
        ),
      );
    };

    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchorRef, open]);

  return open ? coords : null;
}
