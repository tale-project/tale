import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Hands focus on when the element this is attached to leaves the page while
 * the focus is inside it — an error state whose **Try again** a refresh
 * replaced, with its loading state or with the answer. Without it the focus
 * drops to the page body, and a keyboard or screen-reader user loses their
 * place.
 *
 * Returns a callback ref for the element. `onFocusLost` runs a frame after
 * the element leaves, once whatever replaced it has mounted, so it can focus
 * a stable, named target (the list's region, the section around it). Focus
 * the reader moved elsewhere in the meantime stays where it is. The latest
 * `onFocusLost` is the one called, so a host re-rendering with a new callback
 * is never mistaken for the element leaving.
 */
export function useFocusHandoff<T extends HTMLElement>(
  onFocusLost: (() => void) | undefined,
) {
  const [node, setNode] = useState<T | null>(null);
  const onFocusLostRef = useRef(onFocusLost);
  useLayoutEffect(() => {
    onFocusLostRef.current = onFocusLost;
  });
  // The cleanup runs before React detaches the element, while the focus is
  // still inside it.
  useLayoutEffect(() => {
    if (node === null) return undefined;
    return () => {
      const handoff = onFocusLostRef.current;
      const ownerDocument = node.ownerDocument;
      if (handoff !== undefined && node.contains(ownerDocument.activeElement)) {
        requestAnimationFrame(() => {
          const activeElement = ownerDocument.activeElement;
          if (
            activeElement === null ||
            activeElement === ownerDocument.body ||
            node.contains(activeElement)
          ) {
            handoff();
          }
        });
      }
    };
  }, [node]);
  return setNode;
}
