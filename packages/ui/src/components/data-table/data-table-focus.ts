import { useCallback, type RefCallback } from 'react';

import {
  RESTORE_FOCUS_LOST_EVENT,
  RESTORE_FOCUS_RETURNED_EVENT,
  ancestorsOf,
  focusNearestRegion,
} from '../../hooks/use-restore-focus';

/** Marks the table's data rows: not its skeleton, empty-state or expanded rows. */
export const DATA_ROW = { 'data-table-row': '' } as const;

/**
 * Marks the table's create action. It moves between the toolbar and the
 * empty state as the last row leaves or the first arrives, so the focus it
 * held follows it there.
 */
export const ADD_ACTION = { 'data-table-add-action': '' } as const;
const ADD_ACTION_SELECTOR = '[data-table-add-action]';

/**
 * The controls a reader tabs to: what can take the focus a row's control
 * held. Not one taken out of the tab order or marked unavailable, such as a
 * toolbar's **Filter** over an empty list.
 */
const CONTROL = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
]
  .map(
    (selector) =>
      `${selector}:not([tabindex="-1"]):not([aria-disabled="true"])`,
  )
  .join(', ');

/** Where in the body the reader last was: a data row's position and a cell's. */
interface RowPosition {
  row: number;
  cell: number;
}

/** The table's own data rows, in order: never the rows of a table nested in one. */
function dataRows(root: HTMLElement): HTMLTableRowElement[] {
  const body = root.querySelector('tbody');
  if (body === null) return [];
  return [...body.rows].filter((row) => row.hasAttribute('data-table-row'));
}

function focusFirstControl(container: Element | null | undefined): boolean {
  if (container === null || container === undefined) return false;
  for (const control of container.querySelectorAll<HTMLElement>(CONTROL)) {
    control.focus();
    if (control.ownerDocument.activeElement === control) return true;
  }
  return false;
}

/** Whether the focus is nowhere: what a removed element leaves behind. */
function isFocusStranded(doc: Document): boolean {
  const active = doc.activeElement;
  return (
    active === null || active === doc.body || active === doc.documentElement
  );
}

/**
 * Keeps the keyboard in the table when a completed action takes the row it
 * was on: a confirmed delete or revoke removes the row, or the control in it.
 * Without this, focus drops to `<body>` and the next Tab starts again at the
 * top of the page (WCAG 2.4.3).
 *
 * The focus goes to the row that took the lost one's place, then the rows
 * after it, then the rows before it: to the control in the same column
 * first, else to any control in those rows. With no row left, it goes to the
 * create action, in the empty state or the toolbar, then to the first other
 * control in the table, then to the nearest ancestor that takes focus (the
 * list's labelled region). A focused create action that moves between the
 * toolbar and the empty state takes the focus along. It catches both orders
 * a delete can take:
 * - the row leaves while focus is in it, after a dialog returned the focus
 *   to the row's menu button and the list refreshed a moment later;
 * - the row leaves while its dialog is open, so the dialog finds nothing to
 *   return to and asks the table (`RESTORE_FOCUS_LOST_EVENT`).
 *
 * Focus the reader moved elsewhere stays where it is. Returns a stable
 * callback ref for the table's root element; it renders nothing again.
 */
export function useRowFocusRescue<T extends HTMLElement>(): RefCallback<T> {
  return useCallback((root: T | null) => {
    if (root === null) return undefined;
    const doc = root.ownerDocument;
    /** The control in a data row or the create action, while it holds the focus. */
    let holder: HTMLElement | null = null;
    let last: RowPosition | null = null;
    const addAction = () => root.querySelector(ADD_ACTION_SELECTOR);

    const focusSuccessor = (): boolean => {
      const rows = dataRows(root);
      if (last !== null && rows.length > 0) {
        const at = Math.min(last.row, rows.length - 1);
        const cell = last.cell;
        const order = [...rows.slice(at), ...rows.slice(0, at).reverse()];
        // The same column first, so a reader working down a list lands on
        // the next row's menu button; then any control in those rows.
        if (
          order.some((row) => focusFirstControl(row.cells.item(cell))) ||
          order.some((row) => focusFirstControl(row))
        ) {
          return true;
        }
      }
      return (
        focusFirstControl(addAction()) ||
        focusFirstControl(root.querySelector('tbody')) ||
        focusFirstControl(root)
      );
    };

    const onFocusIn = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || doc.activeElement !== target)
        return;
      const rows = dataRows(root);
      const row = rows.findIndex((candidate) => candidate.contains(target));
      const cells = row === -1 ? [] : [...(rows[row]?.cells ?? [])];
      const inAddAction = addAction()?.contains(target) ?? false;
      holder = row !== -1 || inAddAction ? target : null;
      last =
        row === -1
          ? null
          : { row, cell: cells.findIndex((cell) => cell.contains(target)) };
    };
    // Focus moving on to another element (a menu, a dialog) went where the
    // reader sent it. Focus that goes nowhere may be a removal, so the
    // holder is kept until the mutation shows which it was.
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !root.contains(next)) holder = null;
    };
    const observer = new MutationObserver(() => {
      if (holder === null || holder.isConnected) return;
      holder = null;
      if (!isFocusStranded(doc)) return;
      if (!focusSuccessor()) focusNearestRegion(ancestorsOf(root));
    });
    // A table nested in an expanded row answers first; this one then leaves
    // the focus it placed alone.
    const onRestoreFocusLost = (event: Event) => {
      if (!event.defaultPrevented && focusSuccessor()) event.preventDefault();
    };

    root.addEventListener('focusin', onFocusIn);
    root.addEventListener(RESTORE_FOCUS_RETURNED_EVENT, onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    root.addEventListener(RESTORE_FOCUS_LOST_EVENT, onRestoreFocusLost);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener(RESTORE_FOCUS_RETURNED_EVENT, onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      root.removeEventListener(RESTORE_FOCUS_LOST_EVENT, onRestoreFocusLost);
    };
  }, []);
}
