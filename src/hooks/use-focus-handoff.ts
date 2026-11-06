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
 * named target (the list's region, the section around it) — and only when
 * the focus is stranded by then: a control that took it in the meantime
 * keeps it. The latest `onFocusLost` is the one called, so a host
 * re-rendering with a new callback is never mistaken for the element
 * leaving.
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
      const focusScope = node.closest('[role="dialog"], [role="alertdialog"]');
      if (
        onFocusLostRef.current !== undefined &&
        node.contains(document.activeElement)
      ) {
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
            onFocusLostRef.current?.();
          }
        });
      }
    };
  }, []);
}
