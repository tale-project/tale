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
 * Fired when an overlay closes and nothing it could return the focus to is
 * left: the opener, the caller's `restoreFocusRef` and the menu button are
 * gone or can no longer take focus, because a confirmed delete took the row
 * with them. It is dispatched, bubbling and cancelable, from the nearest
 * ancestor of that return point still in the document, so the part of the
 * page that survived can say what took the row's place. A listener that
 * moves the focus there cancels it: `DataTable` focuses the next row's
 * control.
 */
export const RESTORE_FOCUS_LOST_EVENT = 'tale:restore-focus-lost';

/**
 * Focuses `element` if it is still in the document, and says whether it took
 * the focus: a disabled control does not, and neither does `<body>`, which
 * is no place to return to.
 */
function focusIfAble(
  element: HTMLElement | null | undefined,
  options?: FocusOptions,
): boolean {
  if (
    element === null ||
    element === undefined ||
    !element.isConnected ||
    element === element.ownerDocument.body
  ) {
    return false;
  }
  element.focus(options);
  return element.ownerDocument.activeElement === element;
}

/** `element`'s ancestors below `<body>`, nearest first. */
export function ancestorsOf(element: Element): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  const body = element.ownerDocument.body;
  for (
    let ancestor = element.parentElement;
    ancestor !== null && ancestor !== body;
    ancestor = ancestor.parentElement
  ) {
    ancestors.push(ancestor);
  }
  return ancestors;
}

/**
 * Focuses the nearest of `ancestors` that is still in the document and takes
 * programmatic focus (`tabindex`): a list's labelled region, else the page's
 * `<main>`. This is the last place for focus that a removed control held,
 * short of the page itself. The view does not scroll: the reader's place is
 * where the control was, not the region's top.
 */
export function focusNearestRegion(ancestors: readonly HTMLElement[]): boolean {
  return ancestors.some(
    (ancestor) =>
      ancestor.hasAttribute('tabindex') &&
      focusIfAble(ancestor, { preventScroll: true }),
  );
}

/** The overlays a transient opener sits in. */
const TRANSIENT_POPUP = '[role="menu"], [role="listbox"]';
/** How far a submenu chain is followed before giving up. */
const MAX_POPUP_DEPTH = 8;

/**
 * The button whose popup holds `element` — where a keyboard user expects to
 * land once a dialog opened from one of that popup's items closes. The
 * WAI-ARIA menu button pattern names the relation from both ends: the popup
 * is labelled by its button (`aria-labelledby`) or the button controls it
 * (`aria-controls`), and the button declares the popup (`aria-haspopup`).
 * Standard ARIA, like the transient roles themselves, so any menu that
 * follows the pattern answers here (Radix's `DropdownMenu` does). A submenu
 * is labelled by the item that opened it, itself transient, so the walk
 * climbs to the outermost button.
 *
 * Read when the overlay OPENS: by the time it closes, the popup is gone.
 */
function popupButtonOf(element: HTMLElement): HTMLElement | null {
  const doc = element.ownerDocument;
  const idsIn = (value: string | null) => (value ?? '').split(/\s+/);
  const opensAPopup = (candidate: Element | null): candidate is HTMLElement =>
    candidate instanceof HTMLElement &&
    (candidate.getAttribute('aria-haspopup') ?? 'false') !== 'false';
  let current = element;
  for (let depth = 0; depth < MAX_POPUP_DEPTH; depth++) {
    if (!isTransientOpener(current)) return current;
    const popup = current.closest(TRANSIENT_POPUP);
    if (popup === null) return null;
    const button =
      idsIn(popup.getAttribute('aria-labelledby'))
        .map((id) => (id === '' ? null : doc.getElementById(id)))
        .find(opensAPopup) ??
      (popup.id === ''
        ? undefined
        : [...doc.querySelectorAll<HTMLElement>('[aria-controls]')].find(
            (candidate) =>
              idsIn(candidate.getAttribute('aria-controls')).includes(
                popup.id,
              ) && opensAPopup(candidate),
          ));
    if (button === undefined || button === current) return null;
    current = button;
  }
  return null;
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
 * — see `TRANSIENT_OPENER_ROLES`. A menu item's own menu names its button,
 * so the hook finds that button itself (`popupButtonOf`): a dialog opened
 * from a row's actions menu returns focus to that row's menu button with no
 * wiring at the call site. `fallbackRef` is for everything else — an opener
 * that unmounts or moves (a toolbar button the first row replaces), or a
 * return point the caller chooses — and, when set, wins over the menu button.
 * Each of them counts only if it can still take the focus: a menu button its
 * row disabled is skipped like a removed one.
 *
 * A completed action can take every return point away: a confirmed delete
 * removes the row, its menu button with it. The hook then asks the part of
 * the page that survived (`RESTORE_FOCUS_LOST_EVENT`), and failing an answer
 * focuses the nearest surviving ancestor that takes focus
 * (`focusNearestRegion`). Only with neither does Radix's default (`<body>`)
 * apply.
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
  /** The menu button behind a transient opener, read while its menu stands. */
  const popupButton = useRef<HTMLElement | null>(null);
  /**
   * The return point's ancestors when the overlay opened, nearest first:
   * what is left to ask once a completed action removed the point itself.
   */
  const returnPath = useRef<HTMLElement[]>([]);

  useLayoutEffect(() => {
    if (open) {
      const active = document.activeElement;
      const opener = active instanceof HTMLElement ? active : null;
      previouslyFocused.current = opener;
      popupButton.current =
        opener !== null && isTransientOpener(opener)
          ? popupButtonOf(opener)
          : null;
      const returnPoint =
        popupButton.current ??
        (opener !== null && canHoldFocus(opener) ? opener : null);
      returnPath.current = returnPoint === null ? [] : ancestorsOf(returnPoint);
    }
  }, [open]);

  return useCallback(
    (event: Event) => {
      const opener = previouslyFocused.current;
      const path = returnPath.current;
      // Menu items and other transient openers go away with the overlay they
      // belong to; fall back to a stable trigger — the caller's, else the
      // menu button the item's menu named when the overlay opened.
      // `<body>` is no opener either: focus rests there when the focused
      // control was removed in the same update that opened this overlay — an
      // edit dialog's Cancel bringing a details dialog back.
      const candidates = [
        opener !== null && canHoldFocus(opener) ? opener : null,
        fallbackRef?.current,
        popupButton.current,
      ];
      previouslyFocused.current = null;
      popupButton.current = null;
      returnPath.current = [];
      if (candidates.some((candidate) => focusIfAble(candidate))) {
        event.preventDefault();
        return;
      }
      // None of them survived the close, as when a confirmed delete took the
      // row: the nearest ancestor still standing says where the focus goes.
      const survivor = path.find((ancestor) => ancestor.isConnected);
      if (survivor === undefined) return;
      const lost = new CustomEvent(RESTORE_FOCUS_LOST_EVENT, {
        bubbles: true,
        cancelable: true,
      });
      survivor.dispatchEvent(lost);
      if (lost.defaultPrevented || focusNearestRegion(path)) {
        event.preventDefault();
      }
      // Otherwise Radix's default close behaviour runs.
    },
    [fallbackRef],
  );
}

/** An opener that can still be a return point once its overlay closes. */
function canHoldFocus(element: HTMLElement): boolean {
  return element !== element.ownerDocument.body && !isTransientOpener(element);
}
