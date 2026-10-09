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
      const focusScope = node.closest('[role="dialog"], [role="alertdialog"]');
      if (handoff !== undefined && node.contains(document.activeElement)) {
        requestAnimationFrame(() => {
          // Removing the owned control normally strands focus on the page.
          // Another control may take it before this frame; that connected
          // destination keeps focus instead of being replaced. Radix parks a
          // trapped dialog's focus on its root, though, and that fallback must
          // still hand focus to the stable target that replaced the control.
          const doc = node.ownerDocument;
          const active = doc.activeElement;
          if (
            active === null ||
            active === doc.body ||
            active === doc.documentElement ||
            active === focusScope
          ) {
            handoff();
          }
        });
      }
    };
  }, [node]);
  return setNode;
}
