import { RESTORE_FOCUS_LOST_EVENT } from '@tale/ui/use-restore-focus';
import { useEffect, type RefObject } from 'react';

/** Marks a session's row, so the list can find its rows among its other parts. */
export function rowMarker(sessionId: number) {
  return { 'data-session-id': sessionId };
}
const ROW_SELECTOR = '[data-session-id]';

/** What a reader tabs to: a link, or a button that is not disabled. */
const CONTROL = 'a[href], button:not([disabled]):not([aria-disabled="true"])';

function focusFirstControl(container: Element): boolean {
  for (const control of container.querySelectorAll<HTMLElement>(CONTROL)) {
    control.focus();
    if (control.ownerDocument.activeElement === control) return true;
  }
  return false;
}

/**
 * Keeps the keyboard in the list when a deleted session takes its row with it.
 * The dialog that asked to delete finds nothing to give the focus back to (the
 * row and its menu button are gone) and says so with
 * `RESTORE_FOCUS_LOST_EVENT`; the list answers by focusing the row that took
 * the lost one's place, then the rows after it, then the rows before it, and
 * with no row left the first control it has (the button that adds a session).
 * Without this the focus drops to the page and the next Tab starts at its top.
 */
export function useRowFocusRescue(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = root.current;
    if (element === null) return undefined;
    /** Where in the list the keyboard was last: the position of that row. */
    let last = 0;
    const rows = () => [...element.querySelectorAll(ROW_SELECTOR)];

    // A menu button opens its menu without taking the focus on a click, so the
    // row the person is working on is remembered from where they pressed too.
    const remember = (event: Event) => {
      const row =
        event.target instanceof Element
          ? event.target.closest(ROW_SELECTOR)
          : null;
      if (row !== null) last = Math.max(0, rows().indexOf(row));
    };
    const onFocusLost = (event: Event) => {
      if (event.defaultPrevented) return;
      const left = rows();
      const at = Math.min(last, left.length - 1);
      const order = [...left.slice(at), ...left.slice(0, at).reverse()];
      if (order.some((row) => focusFirstControl(row))) {
        event.preventDefault();
      } else if (focusFirstControl(element)) {
        event.preventDefault();
      }
    };

    const remembered = ['focusin', 'pointerdown', 'keydown'] as const;
    for (const type of remembered) element.addEventListener(type, remember);
    element.addEventListener(RESTORE_FOCUS_LOST_EVENT, onFocusLost);
    return () => {
      for (const type of remembered)
        element.removeEventListener(type, remember);
      element.removeEventListener(RESTORE_FOCUS_LOST_EVENT, onFocusLost);
    };
  }, [root]);
}
