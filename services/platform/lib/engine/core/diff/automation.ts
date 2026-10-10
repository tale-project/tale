/**
 * What changed between two versions of an automation, structurally: which
 * nodes were added, removed, renamed or changed and in which fields; what
 * changed in the run input's schema, the output, the description and the
 * tests; and, when the caller hands them over, the data a version keeps
 * beside its document (its settings, task contract and presentation).
 *
 * One diff serves every reader: the version history's stored change summary
 * (`changeSummaryOf` in `./changes`), the compare page and the save dialog's
 * review, the editor's ring around the nodes another window changed, and
 * the MCP and REST compare answers. It is pure and deterministic — the same
 * two documents always give the same answer, in the same order.
 *
 * The rules:
 *  - a node is identified by its `id`; when two nodes share an id, the first
 *    is the node (the one both executors run) and the later ones are data;
 *  - two values are equal when their canonical JSON is (`stableStringify`:
 *    keys sorted, so the order keys were written in never matters), compared
 *    per top-level field of a node — `id` aside;
 *  - `ui` is ignored, the document's and a node's own: the canvas lays every
 *    automation out from its references and never reads it;
 *  - a node whose `type` changed under the same id is changed, not removed
 *    and added;
 *  - a node that comes back under another id with nothing else changed is
 *    renamed (`./renames`), and a field that differs only because it reads a
 *    renamed node by its new id says so (`referencesOnly`);
 *  - the order of nodes, of tests and of the input's properties is not a
 *    change — execution follows references, tests are found by name;
 *  - a field's values are compared through the shared value diff
 *    (`@tale/ui/data/value-diff`), at most {@link MAX_VALUE_CHANGES} changes
 *    listed per field.
 *
 * Triggers and project bindings belong to the automation, not to a version,
 * so no version diff can say anything about them.
 */

import { stableStringify } from '@tale/ui/data/stable-stringify';
import { type DiffChange, diffValues } from '@tale/ui/data/value-diff';

import { isRecord } from '../../../utils/type-utils';
import { newParseCtx, type ParseCtx } from '../syntax/sources';
import type { Automation } from '../types';
import {
  findRenames,
  nodeReferences,
  outputReferences,
  type RawNode,
  type ReferenceIndex,
  type Rename,
  renamesRead,
  rewriteNode,
  rewriteReferences,
} from './renames';

export type ChangeKind = 'added' | 'removed' | 'changed' | 'renamed';

/** How a field's two values are best shown: a code body, a template, a
 * condition, JSON data, plain text, one short value, or a list. */
export type FieldDisplay =
  | 'code'
  | 'template'
  | 'condition'
  | 'json'
  | 'text'
  | 'scalar'
  | 'list';

/** One field that differs between the two versions. */
export interface FieldChange {
  /** A node's field (`prompt`, `model`, `when`, …), a test's (`input`,
   * `expect.output`, …), a document key, or a version's package field. */
  field: string;
  kind: Exclude<ChangeKind, 'renamed'>;
  display: FieldDisplay;
  /** The value before; absent for an added field. */
  before?: unknown;
  /** The value after; absent for a removed field. */
  after?: unknown;
  /** For a changed `json` or `list` field: what changed inside it, value by
   * value. */
  values?: readonly DiffChange[];
  /** `values` stopped at {@link MAX_VALUE_CHANGES}. */
  truncated?: true;
  /** The field differs only because it reads these renamed nodes by their
   * new ids. */
  referencesOnly?: readonly Rename[];
}

/** One node that differs. */
export interface NodeDiff {
  /** Its id — the new one for a renamed node. */
  id: string;
  kind: ChangeKind;
  /** Its type — the earlier one for a removed node; empty when it has none. */
  type: string;
  /** The type it had before, when it changed. */
  typeBefore?: string;
  /** The id it had before, for a renamed node. */
  renamedFrom?: string;
  /** The fields that differ, in the grammar's order; empty for an added or
   * removed node (its definition is at `afterIndex` or `beforeIndex`). */
  fields: readonly FieldChange[];
  /** A changed node whose every changed field only reads renamed nodes by
   * their new ids: it changed because of the rename, not on its own. */
  referencesOnly?: true;
  /** Its position in the `nodes` list of each document that has it. */
  beforeIndex?: number;
  afterIndex?: number;
}

/** One property of the run input's schema that differs — or, with
 * `property: null`, the schema around the properties (its `type`,
 * `additionalProperties`, its own `description`, …). */
export interface InputsDiff {
  property: string | null;
  kind: Exclude<ChangeKind, 'renamed'>;
  /** Whether the property is required, when that changed. */
  required?: { before: boolean; after: boolean };
  /** The declared type on each side that declares one. */
  typeBefore?: string;
  typeAfter?: string;
  /** The property's schema (or the schema's rest) on each side that has
   * it. */
  before?: unknown;
  after?: unknown;
  /** For a schema present on both sides: what changed inside it. */
  values: readonly DiffChange[];
  /** `values` stopped at {@link MAX_VALUE_CHANGES}. */
  truncated?: true;
}

/** One test that differs. Tests are found by name; an unnamed one by its
 * position (`#3`), a repeated name by its occurrence (`checks (2)`). */
export interface TestDiff {
  name: string;
  kind: Exclude<ChangeKind, 'renamed'>;
  /** The fields that differ (`input`, `mocks`, `expect.output`, …); empty
   * for an added or removed test. */
  fields: readonly FieldChange[];
  /** Its position in the `tests` list of each document that has it. */
  beforeIndex?: number;
  afterIndex?: number;
}

export interface AutomationDiff {
  /** There was no earlier document: everything reads as added. */
  first: boolean;
  /** Nothing differs but what the diff ignores (`ui`). */
  identical: boolean;
  /** Nodes by kind. `changed` leaves out a node that only reads a renamed
   * node by its new id: the rename counts once, under `renamed`. */
  counts: { added: number; removed: number; changed: number; renamed: number };
  /** In the later document's order; a removed node where it stood. */
  nodes: readonly NodeDiff[];
  /** The schema-level entry first, then the properties in the later order. */
  inputs: readonly InputsDiff[];
  output: FieldChange | null;
  description: FieldChange | null;
  /** In the later document's order; a removed test where it stood. */
  tests: readonly TestDiff[];
  /** Every other top-level key: the document's `version` and `name`, keys
   * the grammar does not know (an editor keeps them as written), and the
   * `nodes` or `tests` entries no id or name can tell apart. */
  other: readonly FieldChange[];
  /** The version's package data, when the caller passed it. */
  package: readonly FieldChange[];
  /** What differs and is ignored. */
  ignored: readonly 'ui'[];
}

/** A document as stored or drafted: any JSON object, every key kept. */
export type DiffableDocument = Automation | Readonly<Record<string, unknown>>;

/** What a version keeps beside its document (`settings`, `taskContract`,
 * `presentation`), by name; `null` and an absent field are the same. */
export type PackageData = Readonly<Record<string, unknown>>;

export interface DiffDocumentsOptions {
  /** Each version's package data. Compared, field by field, when either is
   * given; a side not given has none. */
  beforePackage?: PackageData | null;
  afterPackage?: PackageData | null;
  /** Pair removed and added nodes that are the same node renamed (on by
   * default). */
  detectRenames?: boolean;
}

/** The most value changes one field lists. */
export const MAX_VALUE_CHANGES = 200;

/** A node's fields in the grammar's order, each with how it is shown: the
 * expression fields as the syntax layer reads them (`syntax/sources.ts`:
 * `code` is a body, `when` and `repeatUntil` are conditions, the other
 * strings are templates), the objects as data, the equipment as lists. */
const NODE_FIELDS: ReadonlyMap<string, FieldDisplay> = new Map([
  ['type', 'scalar'],
  ['when', 'condition'],
  ['elseOf', 'scalar'],
  ['forEach', 'template'],
  ['repeatUntil', 'condition'],
  ['maxRepeats', 'scalar'],
  ['onError', 'scalar'],
  ['input', 'json'],
  ['code', 'code'],
  ['prompt', 'template'],
  ['system', 'template'],
  ['model', 'scalar'],
  ['modelProvider', 'scalar'],
  ['outputSchema', 'json'],
  ['harness', 'scalar'],
  ['skills', 'list'],
  ['connectors', 'list'],
  ['tools', 'list'],
  ['secrets', 'list'],
  ['files', 'json'],
  ['automation', 'scalar'],
]);

/** A test's fields in the order a reader meets them; `expect` is split into
 * its parts. */
const TEST_FIELDS: ReadonlyMap<string, FieldDisplay> = new Map([
  ['description', 'text'],
  ['input', 'json'],
  ['mocks', 'json'],
  ['failures', 'json'],
  ['expect.output', 'json'],
  ['expect.outputIncludes', 'json'],
  ['expect.effects', 'json'],
  ['expect.nodes', 'json'],
  ['expect.failure', 'json'],
]);

/** Top-level keys of `other` that come first, in the grammar's order. */
const OTHER_FIELDS: ReadonlyMap<string, FieldDisplay> = new Map([
  ['version', 'scalar'],
  ['name', 'scalar'],
]);

/** The top-level keys with a section of their own. */
const SECTIONED_KEYS: ReadonlySet<string> = new Set([
  'description',
  'inputs',
  'nodes',
  'output',
  'tests',
  'ui',
]);

const NODE_SKIP: ReadonlySet<string> = new Set(['id', 'ui']);
const NO_KEYS: ReadonlySet<string> = new Set();
const NO_FIELDS: ReadonlyMap<string, FieldDisplay> = new Map();

type RawRecord = Readonly<Record<string, unknown>>;

const EMPTY: RawRecord = {};

/** Equal as data: canonical JSON, an absent value equal only to an absent
 * one (`null` is a value). */
function same(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b;
  return stableStringify(a) === stableStringify(b);
}

function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function kindOf(before: unknown, after: unknown): FieldChange['kind'] {
  if (before === undefined && after !== undefined) return 'added';
  if (after === undefined && before !== undefined) return 'removed';
  return 'changed';
}

/** The display `declared` asks for when both values fit it; otherwise the
 * one their kinds suggest. */
function displayFor(
  declared: FieldDisplay | undefined,
  before: unknown,
  after: unknown,
): FieldDisplay {
  const values = [before, after].filter((value) => value !== undefined);
  const fits = (display: FieldDisplay): boolean =>
    values.every((value) => {
      switch (display) {
        case 'json':
          return true;
        case 'list':
          return Array.isArray(value);
        case 'scalar':
          return value === null || typeof value !== 'object';
        default:
          return typeof value === 'string';
      }
    });
  if (declared !== undefined && fits(declared)) return declared;
  if (values.some((value) => typeof value === 'object' && value !== null)) {
    return 'json';
  }
  return values.some(
    (value) => typeof value === 'string' && value.includes('\n'),
  )
    ? 'text'
    : 'scalar';
}

/** What changed inside two values, through the shared value diff. */
function valueChanges(
  before: unknown,
  after: unknown,
): { values: readonly DiffChange[]; truncated?: true } {
  const diff = diffValues(before, after, {
    arrays: 'auto',
    maxChanges: MAX_VALUE_CHANGES,
  });
  return diff.truncated
    ? { values: diff.changes, truncated: true }
    : { values: diff.changes };
}

function fieldChange(
  field: string,
  before: unknown,
  after: unknown,
  display: FieldDisplay,
  referencesOnly?: readonly Rename[],
): FieldChange {
  const kind = kindOf(before, after);
  const change: FieldChange = { field, kind, display };
  if (before !== undefined) change.before = before;
  if (after !== undefined) change.after = after;
  if (kind === 'changed' && (display === 'json' || display === 'list')) {
    Object.assign(change, valueChanges(before, after));
  }
  if (referencesOnly !== undefined && referencesOnly.length > 0) {
    change.referencesOnly = referencesOnly;
  }
  return change;
}

/** Every field of two records that differs: the known fields in their
 * order, then the others by code units. */
function recordChanges(
  before: RawRecord,
  after: RawRecord,
  known: ReadonlyMap<string, FieldDisplay>,
  skip: ReadonlySet<string>,
  referencesOnly?: (field: string) => readonly Rename[] | undefined,
): FieldChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const fields = [
    ...[...known.keys()].filter((key) => keys.has(key)),
    ...[...keys].filter((key) => !known.has(key)).toSorted(byCodeUnits),
  ];
  const changes: FieldChange[] = [];
  for (const field of fields) {
    const was = before[field];
    const is = after[field];
    if (skip.has(field) || same(was, is)) continue;
    changes.push(
      fieldChange(
        field,
        was,
        is,
        displayFor(known.get(field), was, is),
        referencesOnly?.(field),
      ),
    );
  }
  return changes;
}

/**
 * Order diff entries as the later document reads: an entry it has at its
 * position there, an entry only the earlier document has right after the
 * nearest entry before it there that the later document still has.
 * `survivors` maps an earlier position to its later one.
 */
function inReadingOrder<
  T extends { beforeIndex?: number; afterIndex?: number },
>(entries: readonly T[], survivors: ReadonlyMap<number, number>): T[] {
  const anchorOf = (beforeIndex: number): number => {
    let found = -1;
    for (const index of survivors.keys()) {
      if (index < beforeIndex && index > found) found = index;
    }
    return found === -1 ? -1 : (survivors.get(found) ?? -1);
  };
  const keyOf = (entry: T): [number, number, number] =>
    entry.afterIndex !== undefined
      ? [entry.afterIndex, 0, 0]
      : [anchorOf(entry.beforeIndex ?? 0), 1, entry.beforeIndex ?? 0];
  return entries
    .map((entry) => ({ entry, key: keyOf(entry) }))
    .toSorted(
      ({ key: a }, { key: b }) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2],
    )
    .map(({ entry }) => entry);
}

interface NodeEntry {
  node: RawNode;
  index: number;
}

interface KeyedNodes {
  byId: Map<string, NodeEntry>;
  /** The keyed ids in document order. */
  order: string[];
  /** The entries no id tells apart (none, or one an earlier node has), or
   * the value itself when it is not a list; undefined when there are none. */
  rest: unknown;
}

function keyNodes(value: unknown): KeyedNodes {
  const byId = new Map<string, NodeEntry>();
  const order: string[] = [];
  if (!Array.isArray(value)) return { byId, order, rest: value };
  const rest: unknown[] = [];
  for (const [index, node] of value.entries()) {
    const id = isRecord(node) && typeof node.id === 'string' ? node.id : '';
    if (!isRecord(node) || id === '' || byId.has(id)) {
      rest.push(node);
      continue;
    }
    byId.set(id, { node, index });
    order.push(id);
  }
  return { byId, order, rest: rest.length > 0 ? rest : undefined };
}

function typeOf(node: RawNode): string {
  return typeof node.type === 'string' ? node.type : '';
}

interface NodesOutcome {
  nodes: NodeDiff[];
  renames: ReadonlyMap<string, string>;
  uiDiffers: boolean;
  rest: { before: unknown; after: unknown };
}

/** One node present on both sides — under the same id, or renamed. Null
 * when nothing differs. */
function compareNode(
  was: NodeEntry,
  is: NodeEntry,
  id: string,
  renamedFrom: string | undefined,
  renames: ReadonlyMap<string, string>,
  ctx: ParseCtx,
): NodeDiff | null {
  // Reading the node's references costs a parse, so it is done only when a
  // rename could explain a change.
  let read: { index: ReferenceIndex; rewritten: RawNode | null } | undefined;
  const referencesOnly = (field: string): Rename[] | undefined => {
    if (renames.size === 0) return undefined;
    if (read === undefined) {
      const index = nodeReferences(was.node, ctx);
      read = { index, rewritten: rewriteNode(was.node, index, renames) };
    }
    if (read.rewritten === null) return undefined;
    return same(read.rewritten[field], is.node[field])
      ? renamesRead(read.index, renames, field)
      : undefined;
  };
  const fields = recordChanges(
    was.node,
    is.node,
    NODE_FIELDS,
    NODE_SKIP,
    referencesOnly,
  );
  if (fields.length === 0 && renamedFrom === undefined) return null;
  const diff: NodeDiff = {
    id,
    kind: renamedFrom === undefined ? 'changed' : 'renamed',
    type: typeOf(is.node),
    fields,
    beforeIndex: was.index,
    afterIndex: is.index,
  };
  if (typeOf(was.node) !== diff.type) diff.typeBefore = typeOf(was.node);
  if (renamedFrom !== undefined) diff.renamedFrom = renamedFrom;
  else if (fields.every((field) => field.referencesOnly !== undefined)) {
    diff.referencesOnly = true;
  }
  return diff;
}

function diffNodes(
  beforeValue: unknown,
  afterValue: unknown,
  detectRenames: boolean,
  ctx: ParseCtx,
): NodesOutcome {
  const before = keyNodes(beforeValue);
  const after = keyNodes(afterValue);
  const unpaired = (keyed: KeyedNodes, other: KeyedNodes) =>
    keyed.order.flatMap((id) => {
      const entry = keyed.byId.get(id);
      return entry === undefined || other.byId.has(id)
        ? []
        : [{ id, node: entry.node }];
    });
  const renames = detectRenames
    ? findRenames(unpaired(before, after), unpaired(after, before), ctx)
    : new Map<string, string>();
  const renamedFrom = new Map([...renames].map(([from, to]) => [to, from]));

  let uiDiffers = false;
  const entries: NodeDiff[] = [];
  const survivors = new Map<number, number>();
  for (const id of after.order) {
    const is = after.byId.get(id);
    if (is === undefined) continue;
    const from = renamedFrom.get(id);
    const was = before.byId.get(from ?? id);
    if (was === undefined) {
      entries.push({
        id,
        kind: 'added',
        type: typeOf(is.node),
        fields: [],
        afterIndex: is.index,
      });
      continue;
    }
    survivors.set(was.index, is.index);
    if (!same(was.node.ui, is.node.ui)) uiDiffers = true;
    const diff = compareNode(was, is, id, from, renames, ctx);
    if (diff !== null) entries.push(diff);
  }
  for (const id of before.order) {
    const was = before.byId.get(id);
    if (was === undefined || after.byId.has(id) || renames.has(id)) continue;
    entries.push({
      id,
      kind: 'removed',
      type: typeOf(was.node),
      fields: [],
      beforeIndex: was.index,
    });
  }
  return {
    nodes: inReadingOrder(entries, survivors),
    renames,
    uiDiffers,
    rest: { before: before.rest, after: after.rest },
  };
}

function typeText(schema: unknown): string | undefined {
  if (!isRecord(schema)) return undefined;
  const { type } = schema;
  if (typeof type === 'string') return type;
  if (!Array.isArray(type)) return undefined;
  return type
    .filter((each): each is string => typeof each === 'string')
    .toSorted(byCodeUnits)
    .join('|');
}

/** The names a `required` list holds; null when it is not a list of names. */
function requiredSet(value: unknown): Set<string> | null {
  if (value === undefined) return new Set();
  if (!Array.isArray(value)) return null;
  const names = value.filter(
    (each): each is string => typeof each === 'string',
  );
  return names.length === value.length ? new Set(names) : null;
}

function schemaChange(
  property: string | null,
  before: unknown,
  after: unknown,
  required?: InputsDiff['required'],
): InputsDiff {
  const change: InputsDiff = {
    property,
    kind: kindOf(before, after),
    values: [],
  };
  if (required !== undefined) change.required = required;
  const typeBefore = typeText(before);
  const typeAfter = typeText(after);
  if (typeBefore !== undefined) change.typeBefore = typeBefore;
  if (typeAfter !== undefined) change.typeAfter = typeAfter;
  if (before !== undefined) change.before = before;
  if (after !== undefined) change.after = after;
  if (before !== undefined && after !== undefined && !same(before, after)) {
    Object.assign(change, valueChanges(before, after));
  }
  return change;
}

/**
 * The run input's schema, property by property: a property added, removed,
 * changed in its own schema (type, enum, description, default, …) or in
 * whether it is required. What the schema holds besides `properties` and
 * `required` is one entry; a schema whose `properties` or `required` has
 * another shape is compared as data.
 */
function diffInputs(before: unknown, after: unknown): InputsDiff[] {
  if (same(before, after)) return [];
  const shaped = (value: unknown): value is RawRecord | undefined =>
    value === undefined || isRecord(value);
  if (!shaped(before) || !shaped(after)) {
    return [schemaChange(null, before, after)];
  }
  const propertiesBefore = before?.properties;
  const propertiesAfter = after?.properties;
  const requiredBefore = requiredSet(before?.required);
  const requiredAfter = requiredSet(after?.required);
  const byProperty =
    (propertiesBefore === undefined || isRecord(propertiesBefore)) &&
    (propertiesAfter === undefined || isRecord(propertiesAfter)) &&
    requiredBefore !== null &&
    requiredAfter !== null;
  const restOf = (schema: RawRecord | undefined): RawRecord | undefined => {
    if (schema === undefined || !byProperty) return schema;
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key !== 'properties' && key !== 'required') rest[key] = value;
    }
    return rest;
  };
  const out: InputsDiff[] = [];
  const restBefore = restOf(before);
  const restAfter = restOf(after);
  if (!same(restBefore, restAfter)) {
    out.push(schemaChange(null, restBefore, restAfter));
  }
  if (!byProperty) return out;

  const was = isRecord(propertiesBefore) ? propertiesBefore : EMPTY;
  const is = isRecord(propertiesAfter) ? propertiesAfter : EMPTY;
  const names = new Set([
    ...Object.keys(is),
    ...Object.keys(was),
    ...[...requiredBefore, ...requiredAfter].toSorted(byCodeUnits),
  ]);
  for (const name of names) {
    const required = {
      before: requiredBefore.has(name),
      after: requiredAfter.has(name),
    };
    const requiredChanged = required.before !== required.after;
    if (same(was[name], is[name]) && !requiredChanged) continue;
    out.push(
      schemaChange(
        name,
        was[name],
        is[name],
        requiredChanged ? required : undefined,
      ),
    );
  }
  return out;
}

interface TestEntry {
  name: string;
  test: unknown;
  index: number;
}

interface KeyedTests {
  byKey: Map<string, TestEntry>;
  order: string[];
  /** The value itself when it is not a list. */
  rest: unknown;
}

function keyTests(value: unknown): KeyedTests {
  const byKey = new Map<string, TestEntry>();
  const order: string[] = [];
  if (!Array.isArray(value)) return { byKey, order, rest: value };
  const seen = new Map<string, number>();
  for (const [index, test] of value.entries()) {
    const own =
      isRecord(test) && typeof test.name === 'string' ? test.name : undefined;
    const base = own ?? `#${index + 1}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    const name = occurrence === 1 ? base : `${base} (${occurrence})`;
    // A named and an unnamed test never share a key, whatever the names.
    const key = `${own === undefined ? 'at' : 'name'}\u0000${name}`;
    byKey.set(key, { name, test, index });
    order.push(key);
  }
  return { byKey, order, rest: undefined };
}

/** A test's fields, `expect` split into its parts; a test that is not an
 * object is one field. */
function testFields(test: unknown): RawRecord {
  if (!isRecord(test)) return { '': test };
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(test)) {
    if (key === 'name') continue;
    if (key === 'expect' && isRecord(value)) {
      for (const [part, expected] of Object.entries(value)) {
        fields[`expect.${part}`] = expected;
      }
    } else {
      fields[key] = value;
    }
  }
  return fields;
}

function diffTests(
  beforeValue: unknown,
  afterValue: unknown,
): { tests: TestDiff[]; rest: { before: unknown; after: unknown } } {
  const before = keyTests(beforeValue);
  const after = keyTests(afterValue);
  const entries: TestDiff[] = [];
  const survivors = new Map<number, number>();
  for (const key of after.order) {
    const is = after.byKey.get(key);
    if (is === undefined) continue;
    const was = before.byKey.get(key);
    if (was === undefined) {
      entries.push({
        name: is.name,
        kind: 'added',
        fields: [],
        afterIndex: is.index,
      });
      continue;
    }
    survivors.set(was.index, is.index);
    if (same(was.test, is.test)) continue;
    entries.push({
      name: is.name,
      kind: 'changed',
      fields: recordChanges(
        testFields(was.test),
        testFields(is.test),
        TEST_FIELDS,
        NO_KEYS,
      ),
      beforeIndex: was.index,
      afterIndex: is.index,
    });
  }
  for (const key of before.order) {
    const was = before.byKey.get(key);
    if (was === undefined || after.byKey.has(key)) continue;
    entries.push({
      name: was.name,
      kind: 'removed',
      fields: [],
      beforeIndex: was.index,
    });
  }
  return {
    tests: inReadingOrder(entries, survivors),
    rest: { before: before.rest, after: after.rest },
  };
}

function packageOf(data: PackageData | null | undefined): RawRecord {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data ?? EMPTY)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

/** The document's `output`, and whether it differs only by references to
 * renamed nodes. */
function diffOutput(
  before: unknown,
  after: unknown,
  renames: ReadonlyMap<string, string>,
  ctx: ParseCtx,
): FieldChange | null {
  if (same(before, after)) return null;
  let referencesOnly: Rename[] | undefined;
  if (renames.size > 0 && before !== undefined) {
    const index = outputReferences(before, ctx);
    const rewritten = rewriteReferences(before, index, renames);
    if (rewritten !== null && same(rewritten, after)) {
      referencesOnly = renamesRead(index, renames);
    }
  }
  return fieldChange(
    'output',
    before,
    after,
    displayFor('template', before, after),
    referencesOnly,
  );
}

/**
 * The structural diff of `before` and `after`. `before` is null for the
 * first version of an automation: every node, test and field reads as
 * added.
 */
export function diffAutomationDocuments(
  before: DiffableDocument | null,
  after: DiffableDocument,
  options: DiffDocumentsOptions = {},
): AutomationDiff {
  const was: RawRecord = isRecord(before) ? before : EMPTY;
  const is: RawRecord = isRecord(after) ? after : EMPTY;
  const ctx = newParseCtx();
  // The usual save changes a message or a node or two; a document equal to
  // the one before needs no walk at all.
  const unchanged = before !== null && same(was, is);

  const nodes = unchanged
    ? null
    : diffNodes(was.nodes, is.nodes, options.detectRenames ?? true, ctx);
  const tests = unchanged ? null : diffTests(was.tests, is.tests);
  const renames = nodes?.renames ?? new Map<string, string>();
  const output = diffOutput(was.output, is.output, renames, ctx);
  const description = same(was.description, is.description)
    ? null
    : fieldChange(
        'description',
        was.description,
        is.description,
        displayFor('text', was.description, is.description),
      );
  const inputs = diffInputs(was.inputs, is.inputs);

  const other = recordChanges(was, is, OTHER_FIELDS, SECTIONED_KEYS);
  for (const [field, rest] of [
    ['nodes', nodes?.rest],
    ['tests', tests?.rest],
  ] as const) {
    if (rest !== undefined && !same(rest.before, rest.after)) {
      other.push(fieldChange(field, rest.before, rest.after, 'json'));
    }
  }

  const packageChanges =
    options.beforePackage === undefined && options.afterPackage === undefined
      ? []
      : recordChanges(
          packageOf(options.beforePackage),
          packageOf(options.afterPackage),
          NO_FIELDS,
          NO_KEYS,
        );

  const nodeDiffs = nodes?.nodes ?? [];
  const testDiffs = tests?.tests ?? [];
  const counts = { added: 0, removed: 0, changed: 0, renamed: 0 };
  for (const node of nodeDiffs) {
    if (node.referencesOnly !== true) counts[node.kind] += 1;
  }
  return {
    first: before === null,
    identical:
      nodeDiffs.length === 0 &&
      inputs.length === 0 &&
      output === null &&
      description === null &&
      testDiffs.length === 0 &&
      other.length === 0 &&
      packageChanges.length === 0,
    counts,
    nodes: nodeDiffs,
    inputs,
    output,
    description,
    tests: testDiffs,
    other,
    package: packageChanges,
    ignored: !same(was.ui, is.ui) || nodes?.uiDiffers === true ? ['ui'] : [],
  };
}
