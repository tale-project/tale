import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Restores DOM focus to the control that was focused before an overlay opened.
 *
 * Radix's Dialog only restores focus to its `Trigger` on close (its built-in
 * `onCloseAutoFocus` calls `triggerRef.current?.focus()`). Overlays opened
 * programmatically — via `useState`, a keyboard shortcut, a menu item, etc. —
 * render no `DialogTrigger`, so Radix has nothing to focus and the document
 * falls back to `<body>`. A keyboard or screen-reader user is dumped at the
 * top of the page and loses their place — a WCAG 2.4.3 (Focus Order) failure.
 *
 * This hook captures `document.activeElement` the moment `open` flips to true
 * (in a layout effect, which runs before Radix's passive focus-trap effect, so
 * the opener — not an element inside the dialog — is what gets captured), then
 * returns an `onCloseAutoFocus` handler that re-focuses it. The handler calls
 * `event.preventDefault()` so Radix's trigger-focus (and its fallback to body)
 * does not also run.
 *
 * @param open Whether the overlay is currently open.
 * @returns An `onCloseAutoFocus` handler to pass to `Dialog.Content`.
 */
export function useRestoreFocus(open: boolean) {
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (open) {
      const active = document.activeElement;
      previouslyFocused.current = active instanceof HTMLElement ? active : null;
    }
  }, [open]);

  return useCallback((event: Event) => {
    const target = previouslyFocused.current;
    // Only take over from Radix when the opener still exists in the document;
    // otherwise let Radix's default close behaviour run.
    if (target && target.isConnected) {
      event.preventDefault();
      target.focus();
    }
    previouslyFocused.current = null;
  }, []);
}
