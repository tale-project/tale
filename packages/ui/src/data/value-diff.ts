/**
 * What changed between two values, field by field, each change named by its
 * JSON pointer: what a step received against what it returned, one run
 * against another, an expectation against a result. Values are compared as
 * their JSON (a missing key and `undefined` are the same); objects by key;
 * lists by position or, when every item carries a unique key such as `id`,
 * by that key, so a moved item reads as reordered rather than as every item
 * after it changed.
 */

import type { SchemaTreeSchema } from './infer-schema';
import { isWithin, pointerOf } from './json-pointer';
import { jsonNormalize, stableStringify } from './stable-stringify';
import { kindOf, type ValueKind } from './value-summary';

export type DiffKind =
  | 'added'
  | 'removed'
  | 'changed'
  | 'type-changed'
  | 'reordered'
  | 'unknown';

export interface DiffChange {
  pointer: string;
  path: readonly (string | number)[];
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
  beforeKind?: ValueKind;
  afterKind?: ValueKind;
}

export interface DiffResult {
  changes: readonly DiffChange[];
  /** Exact counts, also past `maxChanges` (up to {@link MAX_DIFF_NODES}
   *  compared values). `unchanged` counts values found equal whole. */
  counts: Record<DiffKind | 'unchanged', number>;
  /** No change of any kind. */
  identical: boolean;
  /** `changes` stopped at `maxChanges`, or the comparison at
   *  {@link MAX_DIFF_NODES}. */
  truncated: boolean;
  /** Mode `includes`: fields `after` holds that the expectation does not
   *  name, left unchecked. */
  notChecked?: number;
}

export interface DiffOptions {
  /** `includes`: `before` is an expectation — keys it leaves out are not
   *  compared, and lists compare by position with the same length. */
  mode?: 'exact' | 'includes';
  /** How lists pair their items: `auto` (the default) pairs by a key field
   *  when every item of both lists carries a unique one, else by position;
   *  mode `includes` always pairs by position. */
  arrays?: 'index' | 'key' | 'auto';
  keyFields?: readonly string[];
  /** Deeper than this, a subtree compares whole: 12. */
  maxDepth?: number;
  /** Changes listed: 500. */
  maxChanges?: number;
  /** Pointers whose value was withheld (redacted or elided) on either side:
   *  their subtree reads `unknown`, never `changed`. */
  unknownAt?: readonly string[];
}

export const DEFAULT_KEY_FIELDS: readonly string[] = [
  'id',
  'key',
  'uuid',
  'number',
  'slug',
  'name',
];

/** The most values one comparison visits. */
export const MAX_DIFF_NODES = 100_000;

interface State {
  mode: 'exact' | 'includes';
  arrays: 'index' | 'key' | 'auto';
  keyFields: readonly string[];
  maxDepth: number;
  maxChanges: number;
  unknownAt: readonly string[];
  changes: DiffChange[];
  counts: Record<DiffKind | 'unchanged', number>;
  truncated: boolean;
  visited: number;
  notChecked: number;
}

export function diffValues(
  before: unknown,
  after: unknown,
  options: DiffOptions = {},
): DiffResult {
  const mode = options.mode ?? 'exact';
  const state: State = {
    mode,
    arrays: mode === 'includes' ? 'index' : (options.arrays ?? 'auto'),
    keyFields: options.keyFields ?? DEFAULT_KEY_FIELDS,
    maxDepth: options.maxDepth ?? 12,
    maxChanges: options.maxChanges ?? 500,
    unknownAt: options.unknownAt ?? [],
    changes: [],
    counts: emptyCounts(),
    truncated: false,
    visited: 0,
    notChecked: 0,
  };
  compare(jsonNormalize(before), jsonNormalize(after), [], 0, state);
  const identical = Object.entries(state.counts).every(
    ([kind, count]) => kind === 'unchanged' || count === 0,
  );
  return {
    changes: state.changes,
    counts: state.counts,
    identical,
    truncated: state.truncated,
    ...(mode === 'includes' ? { notChecked: state.notChecked } : {}),
  };
}

function emptyCounts(): Record<DiffKind | 'unchanged', number> {
  return {
    added: 0,
    removed: 0,
    changed: 0,
    'type-changed': 0,
    reordered: 0,
    unknown: 0,
    unchanged: 0,
  };
}

function record(
  state: State,
  path: readonly (string | number)[],
  reported: DiffKind,
  before: unknown,
  after: unknown,
): void {
  // Inside a withheld value nothing can be known to have changed.
  const kind: DiffKind =
    reported !== 'unknown' && isUnknown(state, pointerOf(path))
      ? 'unknown'
      : reported;
  state.counts[kind] += 1;
  if (state.changes.length >= state.maxChanges) {
    state.truncated = true;
    return;
  }
  state.changes.push({
    pointer: pointerOf(path),
    path: [...path],
    kind,
    ...(before !== undefined ? { before, beforeKind: kindOf(before) } : {}),
    ...(after !== undefined ? { after, afterKind: kindOf(after) } : {}),
  });
}

function isUnknown(state: State, pointer: string): boolean {
  return state.unknownAt.some((withheld) => isWithin(pointer, withheld));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compare(
  before: unknown,
  after: unknown,
  path: (string | number)[],
  depth: number,
  state: State,
): void {
  state.visited += 1;
  if (state.visited > MAX_DIFF_NODES) {
    state.truncated = true;
    return;
  }
  if (isUnknown(state, pointerOf(path))) {
    record(state, path, 'unknown', before, after);
    return;
  }
  if (before === undefined && after === undefined) return;
  if (before === undefined) {
    record(state, path, 'added', undefined, after);
    return;
  }
  if (after === undefined) {
    record(state, path, 'removed', before, undefined);
    return;
  }
  const beforeKind = kindOf(before);
  const afterKind = kindOf(after);
  if (beforeKind !== afterKind) {
    // `null` against a value is a value that changed; any other pair of
    // kinds is a change of type.
    record(
      state,
      path,
      beforeKind === 'null' || afterKind === 'null'
        ? 'changed'
        : 'type-changed',
      before,
      after,
    );
    return;
  }
  if (depth >= state.maxDepth) {
    if (stableStringify(before) === stableStringify(after)) {
      state.counts.unchanged += 1;
    } else {
      record(state, path, 'changed', before, after);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    compareLists(before, after, path, depth, state);
    return;
  }
  if (isRecord(before) && isRecord(after)) {
    compareObjects(before, after, path, depth, state);
    return;
  }
  if (before === after) state.counts.unchanged += 1;
  else record(state, path, 'changed', before, after);
}

function compareObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  path: (string | number)[],
  depth: number,
  state: State,
): void {
  if (stableStringify(before) === stableStringify(after)) {
    state.counts.unchanged += 1;
    return;
  }
  const keys = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].toSorted();
  for (const key of keys) {
    if (state.mode === 'includes' && !Object.hasOwn(before, key)) {
      state.notChecked += 1;
      continue;
    }
    compare(before[key], after[key], [...path, key], depth + 1, state);
  }
}

function compareLists(
  before: readonly unknown[],
  after: readonly unknown[],
  path: (string | number)[],
  depth: number,
  state: State,
): void {
  if (stableStringify(before) === stableStringify(after)) {
    state.counts.unchanged += 1;
    return;
  }
  if (state.mode === 'includes' && before.length !== after.length) {
    record(state, path, 'changed', before, after);
    return;
  }
  const keyField =
    state.arrays === 'index'
      ? null
      : sharedKeyField(before, after, state.keyFields);
  if (keyField === null) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      compare(before[index], after[index], [...path, index], depth + 1, state);
    }
    return;
  }
  const beforeIndex = new Map<string, number>();
  before.forEach((item, index) => {
    beforeIndex.set(keyOf(item, keyField), index);
  });
  const matched: number[] = [];
  after.forEach((item, index) => {
    const at = beforeIndex.get(keyOf(item, keyField));
    if (at === undefined) {
      record(state, [...path, index], 'added', undefined, item);
      return;
    }
    matched.push(at);
    compare(before[at], item, [...path, index], depth + 1, state);
  });
  const afterKeys = new Set(after.map((item) => keyOf(item, keyField)));
  before.forEach((item, index) => {
    if (!afterKeys.has(keyOf(item, keyField))) {
      record(state, [...path, index], 'removed', item, undefined);
    }
  });
  // The items both lists hold, in a different order.
  if (
    matched.some((at, index) => index > 0 && at < (matched[index - 1] ?? 0))
  ) {
    record(state, path, 'reordered', before, after);
  }
}

/** The first key field every item of both lists carries, with values that
 *  are unique within each list; null when none does. */
function sharedKeyField(
  before: readonly unknown[],
  after: readonly unknown[],
  keyFields: readonly string[],
): string | null {
  if (before.length === 0 || after.length === 0) return null;
  for (const field of keyFields) {
    if (uniqueBy(before, field) && uniqueBy(after, field)) return field;
  }
  return null;
}

function uniqueBy(items: readonly unknown[], field: string): boolean {
  const seen = new Set<string>();
  for (const item of items) {
    if (!isRecord(item)) return false;
    const value = item[field];
    if (typeof value !== 'string' && typeof value !== 'number') return false;
    const key = keyOf(item, field);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function keyOf(item: unknown, field: string): string {
  return isRecord(item) ? stableStringify(item[field]) : '';
}

/**
 * What changed between two shapes: fields added or removed, a field whose
 * type changed, and a field that became optional or required (`changed`).
 */
export function diffShapes(
  before: SchemaTreeSchema,
  after: SchemaTreeSchema,
): DiffResult {
  const state: State = {
    mode: 'exact',
    arrays: 'index',
    keyFields: [],
    maxDepth: 12,
    maxChanges: 500,
    unknownAt: [],
    changes: [],
    counts: emptyCounts(),
    truncated: false,
    visited: 0,
    notChecked: 0,
  };
  compareShapes(before, after, [], state);
  const identical = Object.entries(state.counts).every(
    ([kind, count]) => kind === 'unchanged' || count === 0,
  );
  return {
    changes: state.changes,
    counts: state.counts,
    identical,
    truncated: state.truncated,
  };
}

function typeText(schema: SchemaTreeSchema): string {
  const { type } = schema;
  if (type === undefined) return '';
  return typeof type === 'string' ? type : [...type].toSorted().join('|');
}

function compareShapes(
  before: SchemaTreeSchema,
  after: SchemaTreeSchema,
  path: (string | number)[],
  state: State,
): void {
  if (path.length > state.maxDepth) return;
  if (typeText(before) !== typeText(after)) {
    record(state, path, 'type-changed', typeText(before), typeText(after));
    return;
  }
  const beforeProps = before.properties ?? {};
  const afterProps = after.properties ?? {};
  const keys = [
    ...new Set([...Object.keys(beforeProps), ...Object.keys(afterProps)]),
  ].toSorted();
  for (const key of keys) {
    const was = beforeProps[key];
    const is = afterProps[key];
    const at = [...path, key];
    if (was === undefined) {
      record(state, at, 'added', undefined, typeText(is ?? {}));
      continue;
    }
    if (is === undefined) {
      record(state, at, 'removed', typeText(was), undefined);
      continue;
    }
    const wasRequired = before.required?.includes(key) ?? false;
    const isRequired = after.required?.includes(key) ?? false;
    if (wasRequired !== isRequired) {
      record(
        state,
        at,
        'changed',
        wasRequired ? 'required' : 'optional',
        isRequired ? 'required' : 'optional',
      );
    }
    compareShapes(was, is, at, state);
  }
  if (before.items !== undefined && after.items !== undefined) {
    compareShapes(before.items, after.items, [...path, 0], state);
  } else if (before.items !== undefined || after.items !== undefined) {
    record(
      state,
      [...path, 0],
      before.items === undefined ? 'added' : 'removed',
      before.items === undefined ? undefined : typeText(before.items),
      after.items === undefined ? undefined : typeText(after.items),
    );
  }
}

/**
 * Which of `candidates` `after` most likely came from — the value to show a
 * diff against: the one sharing the most leaf values with it (a step's
 * input against the outputs before it). Null when none shares at least half.
 */
export function suggestDiffRoot(
  after: unknown,
  candidates: ReadonlyArray<{ id: string; label: string; value: unknown }>,
): { candidateId: string; score: number } | null {
  const target = leafValues(jsonNormalize(after));
  if (target.size === 0) return null;
  let best: { candidateId: string; score: number } | null = null;
  for (const candidate of candidates) {
    const leaves = leafValues(jsonNormalize(candidate.value));
    let shared = 0;
    for (const leaf of target) if (leaves.has(leaf)) shared += 1;
    const score = shared / target.size;
    if (score >= 0.5 && (best === null || score > best.score)) {
      best = { candidateId: candidate.id, score };
    }
  }
  return best;
}

/** The distinct primitive values of `value`, as JSON text, up to 500. */
function leafValues(value: unknown): Set<string> {
  const leaves = new Set<string>();
  const walk = (node: unknown, depth: number): void => {
    if (leaves.size >= 500 || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (isRecord(node)) {
      for (const entry of Object.values(node)) walk(entry, depth + 1);
      return;
    }
    if (node !== null && node !== undefined && node !== '') {
      leaves.add(stableStringify(node));
    }
  };
  walk(value, 0);
  return leaves;
}
