import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Hands focus on when the element this is attached to leaves the page while
 * the focus is inside it — an error state whose **Try again** a refresh
 * replaced, with its loading state or with the answer; an action that gives
 * way to the status it produced. Without it the focus drops to the page
 * body, and a keyboard or screen-reader user loses their place.
 *
 * Returns a callback ref for the element. It works whether the element
 * alone leaves (its host component stays) or its whole host unmounts: the
 * ref's cleanup runs as React detaches the element, before it removes it,
 * while the focus is still inside. `onFocusLost` runs a frame later, once
 * whatever replaced the element has mounted, so it can focus a stable,
 * named target (the list's region, the section around it). The latest
 * `onFocusLost` is the one called, so a host re-rendering with a new
 * callback is never mistaken for the element leaving.
 */
export function useFocusHandoff<T extends HTMLElement>(
  onFocusLost: (() => void) | undefined,
) {
  const onFocusLostRef = useRef(onFocusLost);
  useLayoutEffect(() => {
    onFocusLostRef.current = onFocusLost;
  });
  return useCallback((node: T | null) => {
    if (node === null) return undefined;
    return () => {
      const handoff = onFocusLostRef.current;
      if (handoff !== undefined && node.contains(document.activeElement)) {
        requestAnimationFrame(() => onFocusLostRef.current?.());
      }
    };
  }, []);
}
