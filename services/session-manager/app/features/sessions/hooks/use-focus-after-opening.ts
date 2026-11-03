import { useEffect, type RefObject } from 'react';

/**
 * Puts the focus on an element of a dialog once the dialog has taken it for
 * itself: a dialog focuses its first field as it opens, else the dialog, and
 * never one of its buttons. For the decision whose answer Enter should give.
 */
export function useFocusAfterOpening(
  element: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const timer = setTimeout(() => element.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [element]);
}
