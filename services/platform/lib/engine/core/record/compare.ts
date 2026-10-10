/**
 * Two runs of one automation side by side: what changed in the version
 * between them, how their input and output differ, and for every step what
 * each run did with it — its status, the conditions it decided and the
 * values they read, what it received and returned, how many items it ran —
 * down to the first step where the two runs went different ways; and the
 * side effects only one of them had, or both had with different input.
 *
 * Two values are told apart by the hashes recorded with them, so the answer
 * is exact even past what was stored of each; where they differ is listed
 * from the stored values, or from their shapes when a value was not stored.
 * Every value it answers is a summary, with its secrets withheld.
 */

import type { SchemaTreeSchema } from '@tale/ui/data/infer-schema';
import { isWithin, pathOf } from '@tale/ui/data/json-pointer';
import { stableStringify } from '@tale/ui/data/stable-stringify';
import {
  type DiffChange,
  type DiffKind,
  type DiffResult,
  diffShapes,
  diffValues,
} from '@tale/ui/data/value-diff';
import { summaryOf, type ValueSummary } from '@tale/ui/data/value-summary';

import { topoSort } from '../execute/controlflow';
import type { Automation, NodeDef } from '../types';
import { canonicalNode } from './replay';
import {
  type Decision,
  END_PATH,
  type EvalTrace,
  type NodeRunRecord,
  START_PATH,
  type UnitStatus,
  type ValueRecord,
} from './types';
import {
  recordedSummary,
  recordValue,
  redactSummary,
  redactValue,
  unlimitedBudget,
  utf8Bytes,
} from './value';

/** A side effect as a run lists it; `item` and `pass` place it in a step
 * that runs per item or repeats. */
export interface CompareEffect {
  node: string;
  connector: string;
  input: unknown;
  item?: number;
  pass?: number;
}

/** One run, as much of it as a comparison reads. */
export interface CompareRun {
  id: string;
  version: number;
  mode: string;
  status: string;
  startedAt: number;
  finishedAt?: number;
  /** The version's document the run executed. */
  document: Automation;
  records: readonly NodeRunRecord[];
  effects: readonly CompareEffect[];
}

export interface RunRef {
  id: string;
  version: number;
  mode: string;
  status: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
}

/** One place two values differ, with each side's value as a summary. */
export interface ValueChange {
  pointer: string;
  path: readonly (string | number)[];
  kind: DiffKind;
  before?: ValueSummary;
  after?: ValueSummary;
  /** Set when the change was read from the two shapes: each side's type
   * (`string`, `number|null`), or `required`/`optional` for a field that
   * became optional or required. */
  shape?: { before?: string; after?: string };
}

export interface ValueComparison {
  /** Whether the two values are the same: by their hashes, exact past what
   * was stored; `false` too when only one side has a value or their sizes
   * differ. `null` when it cannot be told — a side recorded no hash, or
   * neither side has a value. */
  equal: boolean | null;
  changes: ValueChange[];
  /** Exact counts, also past the changes listed. */
  counts: DiffResult['counts'];
  /** Changes of every kind. */
  total: number;
  truncated: boolean;
  /** What the changes were read from: the stored values, their shapes
   * (a side's value was not stored), or nothing (equal, or nothing to
   * compare). */
  basis: 'value' | 'shape' | 'none';
}

/** Why a step reads as different in the two runs, in the order it is
 * looked for: it has a record in one run only, its status differs, one of
 * its decisions went the other way, its input differs, its output does. */
export type DivergenceReason =
  | 'missing'
  | 'status'
  | 'decision'
  | 'input'
  | 'output';

/** What one run did with a step. */
export interface NodeRunFacts {
  status: UnitStatus;
  skip?: NonNullable<NodeRunRecord['skip']>['reason'];
  /** From its start to its end, waits included. */
  durationMs?: number;
  activeMs: number;
  attempt: number;
  failureReason?: string;
  /** Its result was taken from an earlier run. */
  reused?: true;
}

/** What one run's decision of a kind came to. */
export interface DecisionFacts {
  /** `when`, `else`, `repeatUntil`: whether it held. */
  result?: boolean;
  /** `forEach`: how many items. */
  count?: number;
  /** `repeatUntil`: the pass limit stopped it. */
  capped?: boolean;
  /** `upstream`: the skipped steps it read. */
  skipped?: string[];
  /** The condition's value (`when`, `forEach`, `repeatUntil`). */
  value?: ValueSummary;
}

/** A decision that went another way in the two runs, or that one run made
 * and the other did not. */
export interface DecisionDiff {
  kind: Decision['kind'];
  /** The pass a `repeatUntil` decision ended. */
  pass?: number;
  a?: DecisionFacts;
  b?: DecisionFacts;
  /** For a decision that evaluates a condition: whether both runs
   * evaluated the same text. Its values are compared only then. */
  sameSource?: boolean;
  /** The sub-expressions whose values differ, by their range in the
   * condition's text. */
  operands: Array<{
    range: [number, number];
    a?: ValueSummary;
    b?: ValueSummary;
  }>;
}

export interface NodeDiff {
  path: string;
  nodeId: string;
  a?: NodeRunFacts;
  b?: NodeRunFacts;
  /** The first reason the step reads as different; absent when it does
   * not. */
  differs?: DivergenceReason;
  decisions: DecisionDiff[];
  input: ValueComparison;
  output: ValueComparison;
  /** For a step that runs per item: how many each run ran, and how many
   * differ — by status or output, or because one run ran more. */
  items?: { a: number; b: number; differing: number };
}

/** A side effect one run had and the other did not, or both had with
 * different input. */
export interface EffectRef {
  node: string;
  connector: string;
  item?: number;
  pass?: number;
  /** Which of the effects with the same step, connector, item and pass it
   * is, from 0, in the order the run made them. */
  n: number;
  a?: ValueSummary;
  b?: ValueSummary;
  /** How the two inputs differ, for an effect both runs had. */
  input?: ValueComparison;
}

export interface RunDiff {
  a: RunRef;
  b: RunRef;
  version: {
    /** Both runs executed the same version. */
    same: boolean;
    /** Steps both versions have, defined differently; the reserved Start
     * and End steps when the input schema or the output changed. */
    changed: string[];
    added: string[];
    removed: string[];
  };
  input: ValueComparison;
  output: ValueComparison;
  /** Every step either run recorded: Start, then the steps in the
   * execution order of B's version (a step's nested steps right after it),
   * then the steps only A's version has, then End. */
  nodes: NodeDiff[];
  /** The first step in that order, Start left out, that reads as
   * different. */
  firstDivergence?: { path: string; why: DivergenceReason };
  effects: {
    count: { a: number; b: number };
    onlyA: EffectRef[];
    onlyB: EffectRef[];
    changed: EffectRef[];
  };
  /** `nodes`: rows past the cap or the size were left out (never the row of
   * the first divergence); `effects`: effects past the cap; `values`: the
   * rows' value changes and decision operands were left out for size. */
  truncated?: { nodes?: true; effects?: true; values?: true };
}

/** Changes listed for the run's input and output. */
export const RUN_DIFF_MAX_CHANGES = 200;
/** Changes listed per step value and per effect. */
export const NODE_DIFF_MAX_CHANGES = 20;
/** Step rows one comparison lists: as many as fit its size with room left
 * for their values. */
export const COMPARE_MAX_NODES = 500;
/** Effects listed per list (only in A, only in B, changed). */
export const COMPARE_MAX_EFFECTS = 200;

function emptyCounts(): DiffResult['counts'] {
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

function totalOf(counts: DiffResult['counts']): number {
  return Object.entries(counts).reduce(
    (sum, [kind, count]) => (kind === 'unchanged' ? sum : sum + count),
    0,
  );
}

function present(record: ValueRecord | undefined): record is ValueRecord {
  return record !== undefined && record.summary.kind !== 'undefined';
}

/** Whether two recorded values are the same, as far as their records tell:
 * by their hashes; unequal too when one side alone has a value, or their
 * sizes or kinds differ; `null` when neither has a value or it cannot be
 * told. */
function equalRecorded(
  a: ValueRecord | undefined,
  b: ValueRecord | undefined,
): boolean | null {
  if (!present(a) || !present(b)) {
    return present(a) === present(b) ? null : false;
  }
  if (a.hash !== null && b.hash !== null) {
    // A withheld secret and a value that was null hash alike: only the
    // same places withheld on both sides make the values the same.
    return a.hash === b.hash && withheldDiffer(a, b).length === 0;
  }
  if (a.bytes !== b.bytes || a.summary.kind !== b.summary.kind) return false;
  return null;
}

/** The places one side withheld a secret and the other did not; the root
 * when either listed fewer places than it withheld. Two different secrets
 * at the same place stay alike. */
function withheldDiffer(a: ValueRecord, b: ValueRecord): string[] {
  const places = (record: ValueRecord): Set<string> =>
    new Set(
      (record.redacted ?? [])
        .filter((mark) => mark.why !== 'name')
        .map((mark) => mark.pointer),
    );
  const unlisted = (record: ValueRecord): boolean =>
    (record.redactedTotal ?? 0) > (record.redacted ?? []).length;
  const pa = places(a);
  const pb = places(b);
  if (unlisted(a) || unlisted(b)) {
    return pa.size === pb.size &&
      [...pa].every((p) => pb.has(p)) &&
      (a.redactedTotal ?? pa.size) === (b.redactedTotal ?? pb.size)
      ? []
      : [''];
  }
  return [
    ...[...pa].filter((p) => !pb.has(p)),
    ...[...pb].filter((p) => !pa.has(p)),
  ].toSorted();
}

/** The places in a record's stored value that are not the whole value:
 * cut, or a secret withheld; the whole value when more places were marked
 * than listed. A member left out for its name is in neither the stored
 * value nor its hash, so it is not among them. */
function withheldPointers(record: ValueRecord): string[] {
  const elided = record.elided ?? [];
  const redacted = record.redacted ?? [];
  if (
    (record.elidedTotal ?? 0) > elided.length ||
    (record.redactedTotal ?? 0) > redacted.length
  ) {
    return [''];
  }
  return [
    // A list cut for length keeps its first items whole: they compare as
    // they are, and what lies past them is the unplaced difference.
    ...elided.filter((mark) => mark.kind !== 'items').map((m) => m.pointer),
    ...redacted.filter((mark) => mark.why !== 'name').map((m) => m.pointer),
  ];
}

/** The summary of `value`, read at `pointer` of `record`'s stored value:
 * a withheld secret reads `redacted`, a value cut away reads `elided`, and
 * a cut string or list counts what was dropped. */
function summaryAt(
  value: unknown,
  pointer: string,
  record: ValueRecord,
): ValueSummary {
  if (
    record.redacted?.some(
      (mark) => mark.why !== 'name' && isWithin(pointer, mark.pointer),
    )
  ) {
    return { kind: 'redacted' };
  }
  const elisions = record.elided ?? [];
  if (
    elisions.some(
      (mark) =>
        (mark.kind === 'whole' || mark.kind === 'depth') &&
        isWithin(pointer, mark.pointer),
    )
  ) {
    return { kind: 'elided' };
  }
  const summary = redactSummary(summaryOf(value));
  const cut = elisions.find((mark) => mark.pointer === pointer);
  if (cut !== undefined && summary.length !== undefined) {
    summary.length += cut.dropped;
    if (cut.kind === 'string') summary.cut = true;
    delete summary.bytes;
  }
  return summary;
}

function sideOnly(
  record: ValueRecord,
  kind: 'added' | 'removed',
): ValueComparison {
  const counts = emptyCounts();
  counts[kind] = 1;
  return {
    equal: false,
    changes: [
      {
        pointer: '',
        path: [],
        kind,
        ...(kind === 'removed'
          ? { before: redactSummary(record.summary) }
          : { after: redactSummary(record.summary) }),
      },
    ],
    counts,
    total: 1,
    truncated: false,
    basis: 'value',
  };
}

function nothingToCompare(equal: boolean | null): ValueComparison {
  return {
    equal,
    changes: [],
    counts: emptyCounts(),
    total: 0,
    truncated: false,
    basis: 'none',
  };
}

/**
 * Compare two recorded values: equal by their hashes, and where they
 * differ from their stored values — places either side cut or withheld
 * read `unknown`, never `changed` — or from their shapes when a side's
 * value was not stored. A difference the stored values cannot place reads
 * `unknown` at each place either side cut, or at the root. At most `max`
 * changes are listed; counts stay exact.
 */
export function compareValueRecords(
  a: ValueRecord | undefined,
  b: ValueRecord | undefined,
  max: number = NODE_DIFF_MAX_CHANGES,
): ValueComparison {
  if (!present(a)) {
    return present(b) ? sideOnly(b, 'added') : nothingToCompare(null);
  }
  if (!present(b)) return sideOnly(a, 'removed');
  const equal = equalRecorded(a, b);
  if (equal === true) return nothingToCompare(true);
  if (a.hash !== null && a.hash === b.hash) {
    // The same value but for what each side withheld.
    const places = withheldDiffer(a, b);
    const counts = emptyCounts();
    counts.unknown = places.length;
    return {
      equal: false,
      changes: places.slice(0, max).map((pointer) => unknownAt(pointer, a, b)),
      counts,
      total: places.length,
      truncated: places.length > max,
      basis: 'value',
    };
  }
  let changes: ValueChange[];
  let counts: DiffResult['counts'];
  let truncated: boolean;
  let basis: ValueComparison['basis'];
  if (a.value !== undefined && b.value !== undefined) {
    const result = diffValues(a.value, b.value, {
      unknownAt: [...withheldPointers(a), ...withheldPointers(b)],
      maxChanges: max,
      // Each side's marks name its own items by position.
      arrays: 'index',
    });
    changes = result.changes.map((change) => valueChange(change, a, b));
    counts = { ...result.counts };
    truncated = result.truncated;
    basis = 'value';
  } else {
    // Shapes are sampled: a change found where either was cut short is no
    // change found.
    const result = diffShapes(a.shape, b.shape);
    counts = emptyCounts();
    const found: ValueChange[] = [];
    for (const change of result.changes) {
      const sampled = shapeSampled(a.shape, b.shape, change.path);
      const kind = sampled ? 'unknown' : change.kind;
      counts[kind]++;
      if (found.length < max) {
        found.push(
          sampled
            ? { pointer: change.pointer, path: change.path, kind: 'unknown' }
            : shapeChange(change),
        );
      }
    }
    changes = found;
    truncated = result.truncated || result.changes.length > max;
    basis = 'shape';
  }
  if (equal === false && totalOf(counts) === 0) {
    const places = unplaced(a, b);
    changes = places.slice(0, max);
    counts.unknown = places.length;
    truncated = places.length > max;
  }
  // What was kept of a value is the value wherever nothing was cut or
  // withheld, and a shape is read from the whole value: a change found
  // there settles what the hashes could not.
  const settled =
    equal === null && totalOf(counts) > counts.unknown ? false : equal;
  return {
    equal: settled,
    changes,
    counts,
    total: totalOf(counts),
    truncated,
    basis,
  };
}

function valueChange(
  change: DiffChange,
  a: ValueRecord,
  b: ValueRecord,
): ValueChange {
  return {
    pointer: change.pointer,
    path: change.path,
    kind: change.kind,
    ...(change.before !== undefined && {
      before: summaryAt(change.before, change.pointer, a),
    }),
    ...(change.after !== undefined && {
      after: summaryAt(change.after, change.pointer, b),
    }),
  };
}

function shapeChange(change: DiffChange): ValueChange {
  const typeText = (side: unknown): string | undefined =>
    typeof side === 'string' ? side : undefined;
  const before = typeText(change.before);
  const after = typeText(change.after);
  return {
    pointer: change.pointer,
    path: change.path,
    kind: change.kind,
    shape: {
      ...(before !== undefined && { before }),
      ...(after !== undefined && { after }),
    },
  };
}

/** Whether either shape was cut short anywhere along `path`: fields left
 * out of an object, or a place read as any value (its depth or the shape's
 * size ran out). */
function shapeSampled(
  a: SchemaTreeSchema,
  b: SchemaTreeSchema,
  path: ReadonlyArray<string | number>,
): boolean {
  let x: SchemaTreeSchema | undefined = a;
  let y: SchemaTreeSchema | undefined = b;
  for (let depth = 0; ; depth++) {
    for (const shape of [x, y]) {
      if (shape === undefined) continue;
      if (shape['x-omitted'] !== undefined) return true;
      if (shape.type === undefined && shape.anyOf === undefined) return true;
    }
    if (depth >= path.length) return false;
    const key = path[depth];
    x = typeof key === 'number' ? x?.items : x?.properties?.[key];
    y = typeof key === 'number' ? y?.items : y?.properties?.[key];
    if (x === undefined && y === undefined) return false;
  }
}

/** One place the two values may differ though nothing can say how. */
function unknownAt(
  pointer: string,
  a: ValueRecord,
  b: ValueRecord,
): ValueChange {
  const change: ValueChange = {
    pointer,
    path: pathOf(pointer),
    kind: 'unknown',
  };
  if (a.value !== undefined) {
    change.before = summaryAt(valueAt(a.value, pointer), pointer, a);
  }
  if (b.value !== undefined) {
    change.after = summaryAt(valueAt(b.value, pointer), pointer, b);
  }
  return change;
}

/** Two values whose hashes differ while what was kept of them agrees: the
 * difference lies in what either side cut, or nowhere the record says. */
function unplaced(a: ValueRecord, b: ValueRecord): ValueChange[] {
  const pointers = [
    ...new Set(
      [...(a.elided ?? []), ...(b.elided ?? [])].map((mark) => mark.pointer),
    ),
  ];
  const at = pointers.length > 0 ? pointers : [''];
  return at.map((pointer) => unknownAt(pointer, a, b));
}

/** The part of a stored value `pointer` names; undefined when it names
 * nothing there. */
function valueAt(value: unknown, pointer: string): unknown {
  let at = value;
  for (const segment of pathOf(pointer)) {
    if (at === null || typeof at !== 'object') return undefined;
    const next: unknown = Array.isArray(at)
      ? at[Number(segment)]
      : Object.getOwnPropertyDescriptor(at, String(segment))?.value;
    at = next;
  }
  return at;
}

/** One run's records, by where they sit. */
interface RunIndex {
  /** Step rows (`item` and `pass` -1), by path. */
  nodes: Map<string, NodeRunRecord>;
  /** A step's own pass rows (`item` -1), by path. */
  passes: Map<string, NodeRunRecord[]>;
  /** A step's item rows (`pass` -1), by path, then item. */
  items: Map<string, Map<number, NodeRunRecord>>;
}

function indexRecords(records: readonly NodeRunRecord[]): RunIndex {
  const index: RunIndex = {
    nodes: new Map(),
    passes: new Map(),
    items: new Map(),
  };
  for (const record of records) {
    const { path, item, pass } = record.key;
    if (item < 0 && pass < 0) {
      if (!index.nodes.has(path)) index.nodes.set(path, record);
    } else if (item < 0) {
      const passes = index.passes.get(path) ?? [];
      passes.push(record);
      index.passes.set(path, passes);
    } else if (pass < 0) {
      const items = index.items.get(path) ?? new Map<number, NodeRunRecord>();
      if (!items.has(item)) items.set(item, record);
      index.items.set(path, items);
    }
  }
  return index;
}

function durationOf(
  startedAt: number | undefined,
  endedAt: number | undefined,
): number | undefined {
  return startedAt !== undefined &&
    endedAt !== undefined &&
    endedAt >= startedAt
    ? endedAt - startedAt
    : undefined;
}

function factsOf(record: NodeRunRecord): NodeRunFacts {
  const durationMs = durationOf(record.startedAt, record.endedAt);
  return {
    status: record.status,
    ...(record.skip !== undefined && { skip: record.skip.reason }),
    ...(durationMs !== undefined && { durationMs }),
    activeMs: record.activeMs,
    attempt: record.attempt,
    ...(record.failure !== undefined && {
      failureReason: String(record.failure.reason),
    }),
    ...(record.meta.reused !== undefined && { reused: true as const }),
  };
}

const DECISION_ORDER: readonly Decision['kind'][] = [
  'upstream',
  'else',
  'when',
  'forEach',
  'repeatUntil',
  'onError',
];

/** A decision and the row it was recorded on. */
interface Placed {
  decision: Decision;
  row: NodeRunRecord;
  pass?: number;
}

/** A step's decisions, one per kind and pass: its own row's, then its pass
 * rows' `repeatUntil`. */
function decisionsOf(
  node: NodeRunRecord | undefined,
  passes: readonly NodeRunRecord[],
): Map<string, Placed> {
  const out = new Map<string, Placed>();
  for (const row of [...(node === undefined ? [] : [node]), ...passes]) {
    for (const decision of row.decisions) {
      const pass =
        decision.kind === 'repeatUntil'
          ? decision.pass
          : row.key.pass >= 0
            ? row.key.pass
            : undefined;
      const key = `${decision.kind}:${pass ?? ''}`;
      if (!out.has(key)) {
        out.set(key, { decision, row, ...(pass !== undefined && { pass }) });
      }
    }
  }
  return out;
}

function decisionFacts(decision: Decision): DecisionFacts {
  switch (decision.kind) {
    case 'when':
      return { result: decision.result, value: redactSummary(decision.value) };
    case 'else':
      return { result: decision.result };
    case 'upstream':
      return { skipped: [...decision.skipped] };
    case 'forEach':
      return { count: decision.count, value: redactSummary(decision.value) };
    case 'repeatUntil':
      return {
        result: decision.result,
        capped: decision.capped,
        value: redactSummary(decision.value),
      };
    case 'onError':
      break;
  }
  // `onError` states a policy, with no outcome of its own.
  return {};
}

/** Whether two decisions of one kind went the same way. */
function sameOutcome(a: Decision, b: Decision): boolean {
  if (a.kind === 'when' && b.kind === 'when') return a.result === b.result;
  if (a.kind === 'else' && b.kind === 'else') return a.result === b.result;
  if (a.kind === 'forEach' && b.kind === 'forEach') return a.count === b.count;
  if (a.kind === 'repeatUntil' && b.kind === 'repeatUntil') {
    return a.result === b.result && a.capped === b.capped;
  }
  if (a.kind === 'upstream' && b.kind === 'upstream') {
    return (
      stableStringify(a.skipped.toSorted()) ===
      stableStringify(b.skipped.toSorted())
    );
  }
  return a.kind === b.kind;
}

function traceOf(decision: Decision): EvalTrace | undefined {
  return decision.kind === 'when' ||
    decision.kind === 'forEach' ||
    decision.kind === 'repeatUntil'
    ? decision.trace
    : undefined;
}

/** What identifies the condition text a decision evaluated: the field of a
 * top-level step, read from the run's document; for a nested step, the
 * document it came from and the field's pointer in it. */
function conditionSource(
  document: Automation,
  placed: Placed,
  trace: EvalTrace,
): string | undefined {
  const { row, decision } = placed;
  if (row.key.path === row.nodeId) {
    const node = document.nodes.find((n) => n.id === row.nodeId);
    const field: keyof NodeDef | undefined =
      decision.kind === 'when' ||
      decision.kind === 'forEach' ||
      decision.kind === 'repeatUntil'
        ? decision.kind
        : undefined;
    const text = node !== undefined && field !== undefined ? node[field] : null;
    return typeof text === 'string' ? `text:${text}` : undefined;
  }
  return row.meta.docRef === undefined
    ? undefined
    : `doc:${row.meta.docRef}#${trace.pointer}`;
}

function probesOf(
  trace: EvalTrace,
): Map<string, { range: [number, number]; v: ValueSummary }> {
  const out = new Map<string, { range: [number, number]; v: ValueSummary }>();
  for (const unit of trace.units) {
    for (const probe of unit.probes) {
      const key = `${probe.range[0]}:${probe.range[1]}`;
      if (!out.has(key)) out.set(key, { range: probe.range, v: probe.v });
    }
  }
  return out;
}

/** The sub-expressions whose values differ between two traces of the same
 * condition text, in text order. */
function operandsOf(a: EvalTrace, b: EvalTrace): DecisionDiff['operands'] {
  const probesA = probesOf(a);
  const probesB = probesOf(b);
  const operands: DecisionDiff['operands'] = [];
  for (const key of new Set([...probesA.keys(), ...probesB.keys()])) {
    const pa = probesA.get(key);
    const pb = probesB.get(key);
    const va = pa === undefined ? undefined : redactSummary(pa.v);
    const vb = pb === undefined ? undefined : redactSummary(pb.v);
    if (va !== undefined && vb !== undefined) {
      if (stableStringify(va) === stableStringify(vb)) continue;
    }
    const range = pa?.range ?? pb?.range;
    if (range === undefined) continue;
    operands.push({
      range: [range[0], range[1]],
      ...(va !== undefined && { a: va }),
      ...(vb !== undefined && { b: vb }),
    });
  }
  return operands.toSorted(
    (x, y) => x.range[0] - y.range[0] || x.range[1] - y.range[1],
  );
}

function decisionDiffs(
  runA: CompareRun,
  runB: CompareRun,
  a: Map<string, Placed>,
  b: Map<string, Placed>,
): DecisionDiff[] {
  const out: DecisionDiff[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const pa = a.get(key);
    const pb = b.get(key);
    const placed = pa ?? pb;
    if (placed === undefined) continue;
    if (pa !== undefined && pb !== undefined) {
      if (sameOutcome(pa.decision, pb.decision)) continue;
    }
    const traceA = pa === undefined ? undefined : traceOf(pa.decision);
    const traceB = pb === undefined ? undefined : traceOf(pb.decision);
    let sameSource: boolean | undefined;
    let operands: DecisionDiff['operands'] = [];
    if (
      pa !== undefined &&
      pb !== undefined &&
      traceA !== undefined &&
      traceB !== undefined
    ) {
      const sourceA = conditionSource(runA.document, pa, traceA);
      const sourceB = conditionSource(runB.document, pb, traceB);
      sameSource = sourceA !== undefined && sourceA === sourceB;
      if (sameSource) operands = operandsOf(traceA, traceB);
    }
    out.push({
      kind: placed.decision.kind,
      ...(placed.pass !== undefined && { pass: placed.pass }),
      ...(pa !== undefined && { a: decisionFacts(pa.decision) }),
      ...(pb !== undefined && { b: decisionFacts(pb.decision) }),
      ...(sameSource !== undefined && { sameSource }),
      operands,
    });
  }
  return out.toSorted(
    (x, y) =>
      DECISION_ORDER.indexOf(x.kind) - DECISION_ORDER.indexOf(y.kind) ||
      (x.pass ?? -1) - (y.pass ?? -1),
  );
}

function itemCount(
  node: NodeRunRecord | undefined,
  items: Map<number, NodeRunRecord> | undefined,
): number {
  return node?.counts?.items ?? items?.size ?? 0;
}

function itemsDiff(
  nodeA: NodeRunRecord | undefined,
  nodeB: NodeRunRecord | undefined,
  itemsA: Map<number, NodeRunRecord> | undefined,
  itemsB: Map<number, NodeRunRecord> | undefined,
): NodeDiff['items'] {
  if (
    nodeA?.counts === undefined &&
    nodeB?.counts === undefined &&
    itemsA === undefined &&
    itemsB === undefined
  ) {
    return undefined;
  }
  const a = itemCount(nodeA, itemsA);
  const b = itemCount(nodeB, itemsB);
  let differing = Math.abs(a - b);
  for (const [item, rowA] of itemsA ?? []) {
    const rowB = itemsB?.get(item);
    if (rowB === undefined || item >= Math.min(a, b)) continue;
    if (
      rowA.status !== rowB.status ||
      equalRecorded(rowA.output, rowB.output) === false
    ) {
      differing++;
    }
  }
  return { a, b, differing };
}

function divergenceOf(
  node: Omit<NodeDiff, 'differs'>,
): DivergenceReason | undefined {
  if (node.a === undefined || node.b === undefined) return 'missing';
  if (node.a.status !== node.b.status) return 'status';
  if (node.decisions.length > 0) return 'decision';
  if (node.input.equal === false) return 'input';
  if (node.output.equal === false) return 'output';
  return undefined;
}

/** The step of the run's document a record path sits under: the path up
 * to the first nested part (`batch[0:-1]/inner` sits under `batch`). */
function topOf(path: string): string {
  const at = path.indexOf('[');
  return at < 0 ? path : path.slice(0, at);
}

/** Compare paths so that numbers inside them order by value: item 2
 * before item 10. */
function naturalCompare(x: string, y: string): number {
  const xs = x.split(/(\d+)/);
  const ys = y.split(/(\d+)/);
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const p = xs[i] ?? '';
    const q = ys[i] ?? '';
    if (p === q) continue;
    if (i % 2 === 1 && Number(p) !== Number(q)) return Number(p) - Number(q);
    return p < q ? -1 : 1;
  }
  return xs.length - ys.length;
}

function orderOf(doc: Automation): string[] {
  return (topoSort(doc.nodes) ?? doc.nodes).map((n) => n.id);
}

/** Start, the steps in B's execution order with their nested steps right
 * after them in the order they ran, the steps only A's version has, steps
 * neither version names, End. `startOf` answers when a row started (B's,
 * else A's). */
function rowOrder(
  paths: Iterable<string>,
  a: Automation,
  b: Automation,
  startOf: (path: string) => number | undefined,
): string[] {
  const rank = new Map<string, number>();
  for (const id of [...orderOf(b), ...orderOf(a)]) {
    if (!rank.has(id)) rank.set(id, rank.size);
  }
  const group = (path: string): number =>
    path === START_PATH
      ? 0
      : path === END_PATH
        ? 3
        : rank.has(topOf(path))
          ? 1
          : 2;
  return [...paths].toSorted((x, y) => {
    const byGroup = group(x) - group(y);
    if (byGroup !== 0) return byGroup;
    const byRank =
      (rank.get(topOf(x)) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(topOf(y)) ?? Number.MAX_SAFE_INTEGER);
    if (byRank !== 0) return byRank;
    if (topOf(x) !== topOf(y)) return naturalCompare(topOf(x), topOf(y));
    if (x === topOf(x)) return -1;
    if (y === topOf(y)) return 1;
    // Nested steps in the order they ran: a subautomation's own document is
    // not at hand, its records are.
    const byStart =
      (startOf(x) ?? Number.MAX_SAFE_INTEGER) -
      (startOf(y) ?? Number.MAX_SAFE_INTEGER);
    return byStart !== 0 ? byStart : naturalCompare(x, y);
  });
}

function versionDiff(a: CompareRun, b: CompareRun): RunDiff['version'] {
  const nodesA = new Map(a.document.nodes.map((n) => [n.id, n]));
  const nodesB = new Map(b.document.nodes.map((n) => [n.id, n]));
  const changed: string[] = [];
  const added: string[] = [];
  for (const id of orderOf(b.document)) {
    const was = nodesA.get(id);
    const is = nodesB.get(id);
    if (was === undefined) added.push(id);
    else if (is !== undefined && canonicalNode(was) !== canonicalNode(is)) {
      changed.push(id);
    }
  }
  if (
    stableStringify(a.document.inputs) !== stableStringify(b.document.inputs)
  ) {
    changed.unshift(START_PATH);
  }
  if (
    stableStringify(a.document.output) !== stableStringify(b.document.output)
  ) {
    changed.push(END_PATH);
  }
  return {
    same: a.version === b.version,
    changed,
    added,
    removed: orderOf(a.document).filter((id) => !nodesB.has(id)),
  };
}

function refOf(run: CompareRun): RunRef {
  const durationMs = durationOf(run.startedAt, run.finishedAt);
  return {
    id: run.id,
    version: run.version,
    mode: run.mode,
    status: run.status,
    startedAt: run.startedAt,
    ...(run.finishedAt !== undefined && { finishedAt: run.finishedAt }),
    ...(durationMs !== undefined && { durationMs }),
  };
}

/** An effect's item or pass; one that is absent or -1 places it in the
 * step itself. */
function slotOf(index: number | undefined): number | undefined {
  return index !== undefined && index >= 0 ? index : undefined;
}

function effectKey(effect: CompareEffect): string {
  return stableStringify([
    effect.node,
    effect.connector,
    slotOf(effect.item) ?? null,
    slotOf(effect.pass) ?? null,
  ]);
}

function groupEffects(
  effects: readonly CompareEffect[],
): Map<string, CompareEffect[]> {
  const groups = new Map<string, CompareEffect[]>();
  for (const effect of effects) {
    const key = effectKey(effect);
    const group = groups.get(key) ?? [];
    group.push(effect);
    groups.set(key, group);
  }
  return groups;
}

/** Effects matched by step, connector, item and pass, then in the order
 * each run made them; inputs compared with their secrets withheld. */
function effectsDiff(
  a: readonly CompareEffect[],
  b: readonly CompareEffect[],
): { diff: RunDiff['effects']; truncated: boolean } {
  const groupsA = groupEffects(a);
  const groupsB = groupEffects(b);
  const diff: RunDiff['effects'] = {
    count: { a: a.length, b: b.length },
    onlyA: [],
    onlyB: [],
    changed: [],
  };
  let truncated = false;
  const list = (into: EffectRef[], ref: () => EffectRef): void => {
    if (into.length >= COMPARE_MAX_EFFECTS) truncated = true;
    else into.push(ref());
  };
  for (const key of new Set([...groupsB.keys(), ...groupsA.keys()])) {
    const listA = groupsA.get(key) ?? [];
    const listB = groupsB.get(key) ?? [];
    for (let n = 0; n < Math.max(listA.length, listB.length); n++) {
      const ea = listA[n];
      const eb = listB[n];
      const sample = ea ?? eb;
      if (sample === undefined) continue;
      const item = slotOf(sample.item);
      const pass = slotOf(sample.pass);
      const place = {
        node: sample.node,
        connector: sample.connector,
        ...(item !== undefined && { item }),
        ...(pass !== undefined && { pass }),
        n,
      };
      if (ea !== undefined && eb !== undefined) {
        if (
          stableStringify(redactValue(ea.input).value) ===
          stableStringify(redactValue(eb.input).value)
        ) {
          continue;
        }
        list(diff.changed, () => {
          const recordA = recordValue(ea.input, 'unit', unlimitedBudget());
          const recordB = recordValue(eb.input, 'unit', unlimitedBudget());
          return {
            ...place,
            a: recordA.summary,
            b: recordB.summary,
            input: compareValueRecords(recordA, recordB),
          };
        });
      } else if (ea !== undefined) {
        list(diff.onlyA, () => ({ ...place, a: recordedSummary(ea.input) }));
      } else if (eb !== undefined) {
        list(diff.onlyB, () => ({ ...place, b: recordedSummary(eb.input) }));
      }
    }
  }
  return { diff, truncated };
}

/**
 * Compare run `a` with run `b` of the same automation. Steps are ordered by
 * B's version, so the first divergence is the first step, as B ran, where
 * the two runs differ.
 */
export function compareRuns(a: CompareRun, b: CompareRun): RunDiff {
  const indexA = indexRecords(a.records);
  const indexB = indexRecords(b.records);
  const paths = rowOrder(
    new Set([...indexB.nodes.keys(), ...indexA.nodes.keys()]),
    a.document,
    b.document,
    (path) =>
      indexB.nodes.get(path)?.startedAt ?? indexA.nodes.get(path)?.startedAt,
  );
  const nodes: NodeDiff[] = [];
  let firstDivergence: RunDiff['firstDivergence'];
  for (const path of paths) {
    const rowA = indexA.nodes.get(path);
    const rowB = indexB.nodes.get(path);
    const sample = rowB ?? rowA;
    if (sample === undefined) continue;
    const items = itemsDiff(
      rowA,
      rowB,
      indexA.items.get(path),
      indexB.items.get(path),
    );
    const row: Omit<NodeDiff, 'differs'> = {
      path,
      nodeId: sample.nodeId,
      ...(rowA !== undefined && { a: factsOf(rowA) }),
      ...(rowB !== undefined && { b: factsOf(rowB) }),
      decisions: decisionDiffs(
        a,
        b,
        decisionsOf(rowA, indexA.passes.get(path) ?? []),
        decisionsOf(rowB, indexB.passes.get(path) ?? []),
      ),
      input: compareValueRecords(rowA?.input, rowB?.input),
      output: compareValueRecords(rowA?.output, rowB?.output),
      ...(items !== undefined && { items }),
    };
    const differs = divergenceOf(row);
    if (
      differs !== undefined &&
      firstDivergence === undefined &&
      path !== START_PATH
    ) {
      firstDivergence = { path, why: differs };
    }
    nodes.push({ ...row, ...(differs !== undefined && { differs }) });
  }
  const effects = effectsDiff(a.effects, b.effects);
  const nodesTruncated = nodes.length > COMPARE_MAX_NODES;
  const kept = nodesTruncated
    ? keepRows(nodes, COMPARE_MAX_NODES, firstDivergence?.path)
    : nodes;
  return withinDiffBudget({
    a: refOf(a),
    b: refOf(b),
    version: versionDiff(a, b),
    input: compareValueRecords(
      indexA.nodes.get(START_PATH)?.output,
      indexB.nodes.get(START_PATH)?.output,
      RUN_DIFF_MAX_CHANGES,
    ),
    output: compareValueRecords(
      indexA.nodes.get(END_PATH)?.output,
      indexB.nodes.get(END_PATH)?.output,
      RUN_DIFF_MAX_CHANGES,
    ),
    nodes: kept,
    ...(firstDivergence !== undefined && { firstDivergence }),
    effects: effects.diff,
    ...((nodesTruncated || effects.truncated) && {
      truncated: {
        ...(nodesTruncated && { nodes: true as const }),
        ...(effects.truncated && { effects: true as const }),
      },
    }),
  });
}

/** A comparison answers at most this as JSON. */
export const RUN_DIFF_MAX_BYTES = 512 * 1024;

/** The first `max` rows, the row of the first divergence always among them. */
function keepRows(
  nodes: readonly NodeDiff[],
  max: number,
  divergence: string | undefined,
): NodeDiff[] {
  const kept = nodes.slice(0, max);
  if (divergence === undefined || kept.some((n) => n.path === divergence)) {
    return kept;
  }
  const row = nodes.find((n) => n.path === divergence);
  return row === undefined ? kept : [...kept.slice(0, max - 1), row];
}

/** Hold a comparison to {@link RUN_DIFF_MAX_BYTES}: rows' value changes go
 * first (their equality and counts stay), then rows from the end — never
 * the row of the first divergence. */
function withinDiffBudget(diff: RunDiff): RunDiff {
  const size = (d: RunDiff): number => utf8Bytes(JSON.stringify(d));
  if (size(diff) <= RUN_DIFF_MAX_BYTES) return diff;
  let dropped = false;
  const lean = (comparison: ValueComparison): ValueComparison => {
    if (comparison.changes.length === 0) return comparison;
    dropped = true;
    return { ...comparison, changes: [], truncated: true };
  };
  const slim: RunDiff = {
    ...diff,
    nodes: diff.nodes.map((node) => ({
      ...node,
      input: lean(node.input),
      output: lean(node.output),
      decisions: node.decisions.map((decision) => {
        if (decision.operands.length === 0) return decision;
        dropped = true;
        return { ...decision, operands: [] };
      }),
    })),
    effects: {
      ...diff.effects,
      changed: diff.effects.changed.map(({ input, ...ref }) => {
        if (input !== undefined) dropped = true;
        return ref;
      }),
    },
  };
  if (dropped) slim.truncated = { ...diff.truncated, values: true };
  if (size(slim) <= RUN_DIFF_MAX_BYTES) return slim;
  let count = slim.nodes.length;
  let cut = slim;
  while (count > 1 && size(cut) > RUN_DIFF_MAX_BYTES) {
    count = Math.floor(count * 0.75);
    cut = {
      ...slim,
      nodes: keepRows(slim.nodes, count, diff.firstDivergence?.path),
      truncated: { ...slim.truncated, nodes: true },
    };
  }
  return cut;
}
