// How a person moves through the rows of the sessions list with the keyboard.
// It follows the platform's Home list (`features/home/lib/row-navigation.ts`):
// the arrow keys move the focus from row to row, Alt with Up or Down opens the
// previous or next session from anywhere but a text field.

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/** Every row is one link carrying its `data-indicator-key` (the key its highlight rests on); the buttons beside it are not rows. */
const ROW_LINK = 'a[data-indicator-key]';

/** The row links under `root`, in reading order. */
export function rowLinks(root: ParentNode): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>(ROW_LINK));
}

/** Where the focus goes from row `index` of `count` for this key, or `null` when the key moves nothing. */
export function rowFocusIndex(
  event: Pick<
    ReactKeyboardEvent,
    'key' | 'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey'
  >,
  index: number,
  count: number,
): number | null {
  if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
    return null;
  }
  const next =
    event.key === 'ArrowDown'
      ? index + 1
      : event.key === 'ArrowUp'
        ? index - 1
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? count - 1
            : -1;
  return index >= 0 && next >= 0 && next < count ? next : null;
}

/** Where typing happens: Alt and the arrows keep their text-editing meaning there. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * The row that Alt with Up or Down leads to from the open one: the previous or
 * next session of the list on screen, the first or the last when none is open.
 * `null` when the keys belong to another handler, to a text field or a dialog,
 * or when the list is hidden or inert.
 */
export function adjacentRow(
  event: Pick<
    KeyboardEvent,
    | 'key'
    | 'altKey'
    | 'metaKey'
    | 'ctrlKey'
    | 'shiftKey'
    | 'target'
    | 'defaultPrevented'
  >,
  root: ParentNode,
): HTMLAnchorElement | null {
  if (event.defaultPrevented) return null;
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
    return null;
  }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return null;
  if (isEditable(event.target)) return null;
  if (
    event.target instanceof Element &&
    event.target.closest(
      'dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]',
    )
  ) {
    return null;
  }
  if (
    root instanceof Element &&
    root.closest('[inert], [hidden], [aria-hidden="true"]')
  ) {
    return null;
  }
  const rows = rowLinks(root);
  const open = rows.findIndex(
    (row) => row.getAttribute('aria-current') === 'page',
  );
  const down = event.key === 'ArrowDown';
  if (open === -1) return (down ? rows[0] : rows.at(-1)) ?? null;
  return rows[down ? open + 1 : open - 1] ?? null;
}
