import { useLayoutEffect, useState } from 'react';

/**
 * Pick whether a popover anchored on `triggerRef` should open downward or
 * upward. Measures the trigger's position when `open` flips to true and
 * compares against the viewport: if the estimated menu height doesn't fit
 * below the trigger but does fit above, returns `'up'`; otherwise `'down'`.
 *
 * Useful for footer-anchored switchers (language, theme) where the menu
 * would otherwise grow past the viewport edge and shove the page up.
 */
export function useDropdownPlacement(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
  estimatedMenuHeight: number,
): 'up' | 'down' {
  const [placement, setPlacement] = useState<'up' | 'down'>('down');

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportHeight =
      typeof window === 'undefined' ? 0 : window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    // Flip up when the menu doesn't fit below but does fit above. Falls back
    // to whichever side has more room when neither side is comfortable.
    if (spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow) {
      setPlacement('up');
    } else {
      setPlacement('down');
    }
  }, [open, triggerRef, estimatedMenuHeight]);

  return placement;
}
