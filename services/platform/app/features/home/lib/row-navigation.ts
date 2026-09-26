import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/** Every row of a Home list is one link carrying its `data-indicator-key`
 * (the key its highlight rests on); menus and checkboxes sit beside it. */
const ROW_LINK = 'a[data-indicator-key]';

/** The row links under `root`, in reading order. */
export function homeRowLinks(root: ParentNode): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>(ROW_LINK));
}

/**
 * ↑/↓ move between a list's rows (Home/End to its ends) instead of stepping
 * through every row's menu with Tab; Enter opens the row, as any link does.
 * For a list element's `onKeyDown`.
 */
export function moveRowFocus(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const target = event.target;
  if (!(target instanceof HTMLAnchorElement) || !target.matches(ROW_LINK)) {
    return;
  }
  const rows = homeRowLinks(event.currentTarget);
  const index = rows.indexOf(target);
  const next =
    event.key === 'ArrowDown'
      ? rows[index + 1]
      : event.key === 'ArrowUp'
        ? rows[index - 1]
        : event.key === 'Home'
          ? rows[0]
          : event.key === 'End'
            ? rows.at(-1)
            : undefined;
  if (next === undefined) return;
  event.preventDefault();
  next.focus();
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
