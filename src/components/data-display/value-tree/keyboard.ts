import type { ValueTreeRow } from './model';

/**
 * What a key does in a value tree (the WAI-ARIA tree pattern): ↑/↓ move,
 * → opens or steps into a container, ← closes it or steps out to the
 * parent, Home/End jump to the ends, `*` opens every sibling container,
 * Enter activates the row, ⌘/Ctrl+C copies its value and ⇧⌘/Ctrl+C its
 * path, and printable characters jump to a key that starts with them.
 */

export type TreeKeyAction =
  | { type: 'focus'; index: number }
  | { type: 'open'; id: string }
  | { type: 'close'; id: string }
  | { type: 'openSiblings'; ids: readonly string[] }
  | { type: 'activate'; index: number }
  | { type: 'openText'; id: string }
  | { type: 'closeText'; id: string }
  | { type: 'copy'; what: 'value' | 'path' }
  | { type: 'type'; char: string };

export interface TreeKeyInput {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export interface TreeKeyState {
  /** Rows whose long text is shown whole. */
  textOpen: ReadonlySet<string>;
  /** Whether a row's text is long enough to be cut. */
  isLongText: (row: ValueTreeRow) => boolean;
  /** Whether the copy shortcuts are on. */
  copyable: boolean;
}

export function treeKeyAction(
  input: TreeKeyInput,
  rows: readonly ValueTreeRow[],
  activeIndex: number,
  state: TreeKeyState,
): TreeKeyAction | null {
  if (rows.length === 0) return null;
  const last = rows.length - 1;
  const index = Math.min(Math.max(activeIndex, 0), last);
  const row = rows[index];
  const modifier = input.metaKey || input.ctrlKey;
  if (modifier && !input.altKey && input.key.toLowerCase() === 'c') {
    return state.copyable && row.type !== 'more'
      ? { type: 'copy', what: input.shiftKey ? 'path' : 'value' }
      : null;
  }
  if (modifier || input.altKey) return null;
  switch (input.key) {
    case 'ArrowDown':
      return { type: 'focus', index: Math.min(index + 1, last) };
    case 'ArrowUp':
      return { type: 'focus', index: Math.max(index - 1, 0) };
    case 'Home':
      return { type: 'focus', index: 0 };
    case 'End':
      return { type: 'focus', index: last };
    case 'ArrowRight':
      if (row.type !== 'node') return null;
      if (row.container) {
        return row.expanded
          ? { type: 'focus', index: Math.min(index + 1, last) }
          : { type: 'open', id: row.id };
      }
      return state.isLongText(row) && !state.textOpen.has(row.id)
        ? { type: 'openText', id: row.id }
        : null;
    case 'ArrowLeft': {
      if (row.type === 'node' && row.container && row.expanded) {
        return { type: 'close', id: row.id };
      }
      if (row.type === 'node' && state.textOpen.has(row.id)) {
        return { type: 'closeText', id: row.id };
      }
      if (row.parentId === null) return null;
      const parent = rows.findIndex((each) => each.id === row.parentId);
      return parent < 0 ? null : { type: 'focus', index: parent };
    }
    case '*': {
      const ids = rows
        .filter(
          (each) =>
            each.type === 'node' &&
            each.parentId === row.parentId &&
            each.container &&
            !each.expanded,
        )
        .map((each) => each.id);
      return ids.length > 0 ? { type: 'openSiblings', ids } : null;
    }
    case 'Enter':
      return { type: 'activate', index };
    default:
      return input.key.length === 1 && input.key !== ' '
        ? { type: 'type', char: input.key }
        : null;
  }
}

/** The text type-ahead matches a row by: its key. */
function keyText(row: ValueTreeRow): string {
  if (row.type === 'more') return '';
  return row.key === null ? '' : String(row.key);
}

/**
 * The row type-ahead lands on for `buffer`: the next row after `fromIndex`
 * (wrapping) whose key starts with it, ignoring case. A buffer of one
 * repeated character ("aaa") steps through the keys that start with it.
 */
export function typeaheadMatch(
  rows: readonly ValueTreeRow[],
  fromIndex: number,
  buffer: string,
): number | null {
  if (buffer === '' || rows.length === 0) return null;
  const lower = buffer.toLocaleLowerCase();
  // One character typed again and again ("aaa") steps through its keys.
  const repeated = /^(.)\1*$/su.test(lower);
  const needle = repeated ? (/^./su.exec(lower)?.[0] ?? lower) : lower;
  // A fresh search starts after the active row; a growing one may stay.
  const start = repeated || buffer.length === 1 ? fromIndex + 1 : fromIndex;
  for (let step = 0; step < rows.length; step++) {
    const at = (start + step) % rows.length;
    if (keyText(rows[at]).toLocaleLowerCase().startsWith(needle)) return at;
  }
  return null;
}
