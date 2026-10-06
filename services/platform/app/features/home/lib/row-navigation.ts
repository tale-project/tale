import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/** Every row of a Home list is one link carrying its `data-indicator-key`
 * (the key its highlight rests on); menus and checkboxes sit beside it. */
const ROW_LINK = 'a[data-indicator-key]';

/** The row links under `root`, in reading order. */
export function homeRowLinks(root: ParentNode): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>(ROW_LINK));
}

/** Return the next row index for a picker or virtualized list. */
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

/** Where typing happens — ⌥↑/⌥↓ keep their text-editing meaning there. */
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
 * The row ⌥↑/⌥↓ lead to from the open one: the previous or next item of the
 * list on screen — the first or last when nothing in it is open. `null`
 * when the keys are not this shortcut, or belong to a text field.
 */
export function adjacentRow(
  event: Pick<
    KeyboardEvent,
    'key' | 'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'target'
  >,
  root: ParentNode,
): HTMLAnchorElement | null {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
    return null;
  }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return null;
  if (isEditable(event.target)) return null;
  // The work lists only (`ol`) — the projects above them are doors, not items.
  const rows = Array.from(
    root.querySelectorAll<HTMLAnchorElement>(`ol ${ROW_LINK}`),
  );
  const open = rows.findIndex(
    (row) => row.getAttribute('aria-current') === 'page',
  );
  const down = event.key === 'ArrowDown';
  if (open === -1) return (down ? rows[0] : rows.at(-1)) ?? null;
  return rows[down ? open + 1 : open - 1] ?? null;
}
