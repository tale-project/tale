import { pathOf, pointerOf } from '../../../data/json-pointer';
import { kindOf, type ValueKind } from '../../../data/value-summary';

/**
 * The rows a value tree shows, as a flat list in reading order: every row
 * says its level, its place among its siblings and how many siblings it
 * has, so the list reads as a tree (WAI-ARIA `aria-level`,
 * `aria-posinset`, `aria-setsize`) and can be windowed like any list.
 */

export type ValueMarkKind =
  | 'added'
  | 'removed'
  | 'changed'
  | 'type-changed'
  | 'focus'
  | 'missing';

/** A highlight on one place in a value; `before` is what a changed value
 *  was, for the words "Changed from 250". */
export interface ValueMark {
  kind: ValueMarkKind;
  before?: unknown;
}

/** Highlights by JSON pointer. */
export type ValueMarks = ReadonlyMap<string, ValueMarkKind | ValueMark>;

/** One place a recorder cut a value to keep it small (`RecordedValue`). */
export interface ValueElision {
  pointer: string;
  /** `string`: characters dropped from its end; `items`: list entries
   *  dropped; `depth`: a value past the depth kept, now `null`; `whole`:
   *  nothing of the value was kept (`dropped` is its size in bytes). */
  kind: 'string' | 'items' | 'depth' | 'whole';
  dropped: number;
}

interface RowBase {
  /** Unique among the rows; a node's id is its pointer. */
  id: string;
  /** 1 for the top level. */
  level: number;
  posinset: number;
  setsize: number;
  /** The id of the row it sits under; null at the top level. */
  parentId: string | null;
}

export interface ValueNodeRow extends RowBase {
  type: 'node';
  pointer: string;
  path: readonly (string | number)[];
  /** Its key in its parent; null for a value shown alone (not a container). */
  key: string | number | null;
  value: unknown;
  kind: ValueKind;
  /** A list or an object with something in it: it opens. */
  container: boolean;
  childCount: number;
  expanded: boolean;
  mark?: ValueMark;
  elided: readonly ValueElision[];
  redacted: boolean;
}

/** A key a mark names that the value does not have: "amount — missing". */
export interface ValueMissingRow extends RowBase {
  type: 'missing';
  pointer: string;
  path: readonly (string | number)[];
  key: string | number;
}

/** "Show 50 more": the next page of a container's children. */
export interface ValueMoreRow extends RowBase {
  type: 'more';
  /** The container it pages. */
  containerPointer: string;
  shown: number;
  total: number;
  /** How many the next page shows. */
  next: number;
}

export type ValueTreeRow = ValueNodeRow | ValueMissingRow | ValueMoreRow;

export interface FlattenOptions {
  /** Containers opened or closed by the reader, by pointer. */
  expanded?: ReadonlyMap<string, boolean>;
  /** Children shown per container, by pointer, past the first page. */
  shown?: ReadonlyMap<string, number>;
  /** Containers at a level below this open on their own: 1 (the top level
   *  shows, its containers closed). */
  defaultExpandDepth?: number;
  /** Children per page: 50. */
  pageSize?: number;
  marks?: ValueMarks;
  elided?: readonly ValueElision[];
  redacted?: readonly string[];
  /** Opened up to, like a mark. */
  selectedPointer?: string | null;
}

export function markOf(
  mark: ValueMarkKind | ValueMark | undefined,
): ValueMark | undefined {
  if (mark === undefined) return undefined;
  return typeof mark === 'string' ? { kind: mark } : mark;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The keys of a container, in its own order. */
export function childKeys(value: unknown): (string | number)[] {
  if (Array.isArray(value)) return value.map((_, index) => index);
  if (isRecord(value)) return Object.keys(value);
  return [];
}

function childAt(value: unknown, key: string | number): unknown {
  if (Array.isArray(value) && typeof key === 'number') return value[key];
  if (isRecord(value) && Object.hasOwn(value, String(key))) {
    return value[String(key)];
  }
  return undefined;
}

/** The value at `path`, or undefined when it is not there. */
export function valueAt(
  value: unknown,
  path: readonly (string | number)[],
): unknown {
  let node = value;
  for (const segment of path) {
    if (Array.isArray(node)) {
      node = typeof segment === 'number' ? node[segment] : undefined;
    } else if (isRecord(node)) {
      node = Object.hasOwn(node, String(segment))
        ? node[String(segment)]
        : undefined;
    } else return undefined;
  }
  return node;
}

/** Whether a value has children to open. */
export function isOpenable(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return isRecord(value) && Object.keys(value).length > 0;
}

/** Pointers of `pointer`'s ancestors, the whole value (`''`) first. */
function ancestorsOf(pointer: string): string[] {
  let path: (string | number)[];
  try {
    path = pathOf(pointer);
  } catch (error) {
    console.warn(`A value tree was given an unreadable pointer`, error);
    return [];
  }
  return path.map((_, index) => pointerOf(path.slice(0, index)));
}

interface Reveal {
  /** Containers opened so a mark or the selection shows. */
  open: Set<string>;
  /** Per container, the furthest child position a revealed place needs. */
  reach: Map<string, number>;
}

/** What has to open, and how far each container must page, for every
 *  marked place and the selection to show. */
function revealFor(value: unknown, pointers: readonly string[]): Reveal {
  const open = new Set<string>();
  const reach = new Map<string, number>();
  for (const pointer of pointers) {
    let path: (string | number)[];
    try {
      path = pathOf(pointer);
    } catch (error) {
      console.warn(`A value tree was given an unreadable pointer`, error);
      continue;
    }
    for (const ancestor of ancestorsOf(pointer)) open.add(ancestor);
    // Page far enough that each step down the path is on screen.
    let node = value;
    for (let depth = 0; depth < path.length; depth++) {
      const key = path[depth];
      const container = pointerOf(path.slice(0, depth));
      const keys = childKeys(node);
      const at = keys.findIndex((each) => String(each) === String(key));
      if (at >= 0)
        reach.set(container, Math.max(reach.get(container) ?? 0, at));
      node = childAt(node, key);
    }
  }
  return { open, reach };
}

/**
 * The rows of `value` with the reader's state applied. A container shows
 * its children when open (by the reader, by `defaultExpandDepth`, or to
 * reveal a mark or the selection), a page at a time. A value that is not
 * a container with something in it shows as one row. Marks of kind
 * `missing` add a ghost row under their parent.
 */
export function flattenValue(
  value: unknown,
  options: FlattenOptions = {},
): ValueTreeRow[] {
  const expanded = options.expanded ?? new Map<string, boolean>();
  const shown = options.shown ?? new Map<string, number>();
  const defaultExpandDepth = options.defaultExpandDepth ?? 1;
  const pageSize = Math.max(1, options.pageSize ?? 50);
  const marks = new Map<string, ValueMark>();
  for (const [pointer, mark] of options.marks ?? []) {
    const normalized = markOf(mark);
    if (normalized !== undefined) marks.set(pointer, normalized);
  }
  const elidedAt = new Map<string, ValueElision[]>();
  for (const elision of options.elided ?? []) {
    elidedAt.set(elision.pointer, [
      ...(elidedAt.get(elision.pointer) ?? []),
      elision,
    ]);
  }
  const redacted = new Set(options.redacted ?? []);
  const revealed = [
    ...marks.keys(),
    ...(options.selectedPointer ? [options.selectedPointer] : []),
  ];
  const reveal = revealFor(value, revealed);
  // Ghost rows: marked `missing` keys, grouped under their parent.
  const missingUnder = new Map<string, (string | number)[][]>();
  for (const [pointer, mark] of marks) {
    if (mark.kind !== 'missing') continue;
    let path: (string | number)[];
    try {
      path = pathOf(pointer);
    } catch (error) {
      console.warn(`A value tree was given an unreadable pointer`, error);
      continue;
    }
    if (path.length === 0 || valueAt(value, path) !== undefined) continue;
    const parent = pointerOf(path.slice(0, -1));
    missingUnder.set(parent, [...(missingUnder.get(parent) ?? []), path]);
  }

  const rows: ValueTreeRow[] = [];
  const ancestors = new Set<unknown>();

  const nodeRow = (
    node: unknown,
    path: (string | number)[],
    key: string | number | null,
    level: number,
    posinset: number,
    setsize: number,
    parentId: string | null,
  ): ValueNodeRow => {
    const pointer = pointerOf(path);
    // A value that holds itself (never JSON) shows as a closed row.
    const container = isOpenable(node) && !ancestors.has(node);
    const isOpen =
      container &&
      (expanded.get(pointer) ??
        (level < defaultExpandDepth || reveal.open.has(pointer)));
    return {
      type: 'node',
      id: pointer,
      pointer,
      path,
      key,
      level,
      posinset,
      setsize,
      parentId,
      value: node,
      kind: kindOf(node),
      container,
      childCount: childKeys(node).length,
      expanded: isOpen,
      ...(marks.has(pointer) ? { mark: marks.get(pointer) } : {}),
      elided: elidedAt.get(pointer) ?? [],
      redacted: redacted.has(pointer),
    };
  };

  const children = (
    node: unknown,
    path: (string | number)[],
    level: number,
    parentId: string | null,
  ): void => {
    const pointer = pointerOf(path);
    const keys = childKeys(node);
    const ghosts = missingUnder.get(pointer) ?? [];
    const firstPage = Math.max(pageSize, (reveal.reach.get(pointer) ?? -1) + 1);
    const visible = Math.min(
      keys.length,
      Math.max(firstPage, shown.get(pointer) ?? 0),
    );
    const setsize = keys.length + ghosts.length;
    ancestors.add(node);
    for (let index = 0; index < visible; index++) {
      const key = keys[index];
      const childPath = [...path, key];
      const row = nodeRow(
        childAt(node, key),
        childPath,
        key,
        level,
        index + 1,
        setsize,
        parentId,
      );
      rows.push(row);
      if (row.expanded) children(row.value, childPath, level + 1, row.id);
    }
    ghosts.forEach((ghostPath, index) => {
      const ghostKey = ghostPath[ghostPath.length - 1];
      const ghostPointer = pointerOf(ghostPath);
      rows.push({
        type: 'missing',
        id: `${ghostPointer}\u0000missing`,
        pointer: ghostPointer,
        path: ghostPath,
        key: ghostKey,
        level,
        posinset: keys.length + index + 1,
        setsize,
        parentId,
      });
    });
    if (visible < keys.length) {
      rows.push({
        type: 'more',
        id: `${pointer}\u0000more`,
        containerPointer: pointer,
        shown: visible,
        total: keys.length,
        next: Math.min(pageSize, keys.length - visible),
        level,
        posinset: visible + 1,
        setsize,
        parentId,
      });
    }
    ancestors.delete(node);
  };

  if (isOpenable(value)) children(value, [], 1, null);
  else rows.push(nodeRow(value, [], null, 1, 1, 1, null));
  return rows;
}
