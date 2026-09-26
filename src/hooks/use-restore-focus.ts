import { type RefObject, useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Roles whose elements live inside an overlay that closes when one of them is
 * chosen. Such an element is never a restore target: by the time the dialog it
 * opened is closed again, its menu is gone or going.
 *
 * Whether it is still in the document at that moment is not something a
 * caller can rely on — a dropdown keeps its items mounted through its closing
 * animation, so an `isConnected` check passes, the item takes the focus, and
 * the unmount a moment later drops the document on `<body>`. The role says
 * what the DOM cannot: this thing is transient. Standard ARIA, so it holds for
 * any menu implementation, not just the one behind `DropdownMenu`.
 */
const TRANSIENT_OPENER_ROLES: ReadonlySet<string> = new Set([
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
]);

function isTransientOpener(element: HTMLElement): boolean {
  const role = element.getAttribute('role');
  return role !== null && TRANSIENT_OPENER_ROLES.has(role);
}

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
 * What it captured is not always a control that can hold focus past the close
 * — see `TRANSIENT_OPENER_ROLES` — which is what `fallbackRef` is for.
 *
 * @param open Whether the overlay is currently open.
 * @param fallbackRef Optional stable element to focus when the captured opener
 *   cannot hold focus past the close — it was removed from the DOM, or it is
 *   an item of an overlay that closes with it (a dropdown's menu item).
 * @returns An `onCloseAutoFocus` handler to pass to `Dialog.Content`.
 */
export function useRestoreFocus(
  open: boolean,
  fallbackRef?: RefObject<HTMLElement | null>,
) {
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (open) {
      const active = document.activeElement;
      previouslyFocused.current = active instanceof HTMLElement ? active : null;
    }
  }, [open]);

  return useCallback(
    (event: Event) => {
      let target = previouslyFocused.current;
      // Menu items and other transient openers go away with the overlay they
      // belong to; fall back to a stable trigger (e.g. the menu button).
      // `<body>` is no opener either: focus rests there when the focused
      // control was removed in the same update that opened this overlay — an
      // edit dialog's Cancel bringing a details dialog back.
      if (
        target === null ||
        !target.isConnected ||
        target === target.ownerDocument.body ||
        isTransientOpener(target)
      ) {
        target = fallbackRef?.current ?? null;
      }
      // Only take over from Radix when a restore target still exists in the
      // document; otherwise let Radix's default close behaviour run.
      if (target && target.isConnected) {
        event.preventDefault();
        target.focus();
      }
      previouslyFocused.current = null;
    },
    [fallbackRef],
  );
}
