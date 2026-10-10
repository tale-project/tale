/**
 * What data travelled where during a run, and when: every reference a step
 * read, from the step (or the run input) that produced the value, at the
 * moment the step read it, with a glimpse of the value it read.
 *
 * Derived when a run is read, from the version's document (immutable, so
 * the references are the ones the run evaluated) and the stored records
 * (which hold the times and the values). Nothing of it is stored. Pure and
 * browser-safe.
 *
 * A step reads its `when` condition first — whether it then holds or not,
 * and when it throws, at the moment it failed. Once the condition let it
 * through, it reads its `forEach` list, once, and its data fields (`input`,
 * `prompt`, `system`, `files`, `code`) each time it works: once for a plain
 * step, once per item of a step that runs per item, once per pass of a step
 * that repeats. A step whose condition failed read nothing else. A repeat's
 * settling condition is read after each pass it decided; what it reads of
 * the step's own output comes from no other step. A read of `item` is a
 * read of the list `forEach` named when that list is one plain reference
 * (`{{ nodes.fetch.output.issues }}`); any other `forEach` computes its
 * list, and the item comes from no step.
 *
 * A step inside a subautomation is described by the subautomation's own
 * document, which this derivation is not given: such steps add no travels.
 * Neither does a step whose result was taken from an earlier run — nothing
 * travelled in this one.
 */

import { isWithin, pointerOf } from '@tale/ui/data/json-pointer';
import type { ValueSummary } from '@tale/ui/data/value-summary';

import {
  newParseCtx,
  outputSources,
  sourcesOf,
  type ExprSource,
  type SourceField,
} from '../syntax/sources';
import { isSingleTemplate } from '../syntax/tokens';
import type { RefSite } from '../syntax/walk';
import type { Automation, NodeDef } from '../types';
import { failedAndContinued } from './skip-chain';
import {
  END_PATH,
  START_PATH,
  type NodeRunRecord,
  type ValueRecord,
} from './types';
import { recordedSummary } from './value';
import { latestPerUnit } from './view';

/** Travels one run answers; the rest are counted. */
export const MAX_TRAVELS = 1000;

/**
 * What a read was for: `data`, a step's data field reading another step;
 * `entry`, a data field reading the run input; `order`, a `when` condition
 * reading either (the value went into the step's condition, not its work).
 */
export type TravelKind = 'data' | 'order' | 'entry';

export interface Travel {
  /** Where the value came from. */
  from: { kind: 'input' } | { kind: 'node'; nodeId: string };
  /** The field that read it: its document pointer and the reference's
   * UTF-16 range in the field's text. */
  to: {
    path: string;
    field: SourceField;
    pointer: string;
    range: [number, number];
  };
  /** The static path read below the source's output (or the run input);
   * `[]` for all of it. */
  refPath: Array<string | number>;
  /** Epoch ms: when the step read it. */
  at: number;
  item?: number;
  pass?: number;
  /** The value read, from the source's stored value: absent when that value
   * was not stored, or the path leads out of it. */
  value?: ValueSummary;
  /** `source` is a step's path, or `__start` for the run input; `target`
   * the reading step's path (`__end` for the document output). */
  edge: { source: string; target: string; kind: TravelKind };
}

/** A reference, and the field it sits in. */
interface Reading {
  source: ExprSource;
  site: RefSite;
}

/** A reading whose source is known: a step or the run input. `item` marks a
 * read of the forEach item, resolved per item through the list. */
interface Resolved {
  reading: Reading;
  origin: {
    source: string;
    refPath: Array<string | number>;
    readable: boolean;
  };
  item?: true;
}

/** What one step reads, by when it reads it. */
interface StepReads {
  /** `/nodes/<index>`: where the step's own fields sit. */
  pointer: string;
  when: Resolved[];
  forEach: Resolved[];
  /** The data fields of a unit that is not one item. */
  data: Resolved[];
  /** The data fields of one item, its reads of `item` included. */
  itemData: Resolved[];
  /** The settling condition of a repeat, without the step's own output. */
  repeatUntil: Resolved[];
}

/** Reads made at one moment by one unit: they travel together. */
interface Group {
  at: number;
  /** A condition's reads come before the work they let through. */
  order: boolean;
  unitOrder: number;
  phase: number;
  record: NodeRunRecord;
  reads: readonly Resolved[];
}

const INDEX = /^(0|[1-9][0-9]*)$/;

/** The keys a reference reads statically: a called method is no read. */
function keysOf(site: RefSite): Array<string | number> {
  const keys = site.path.map((step) => step.key);
  return site.called === true && keys.length > 0 ? keys.slice(0, -1) : keys;
}

/** Where a reference's value comes from, or undefined for a name no step
 * or input stands behind (`item`, `index`, a dynamic step, a free name, and
 * `input` in a transform's code, which is the step's own resolved input). */
function originOf(
  site: RefSite,
  field: SourceField,
): Resolved['origin'] | undefined {
  if (site.root === 'input' && field !== 'code') {
    return { source: START_PATH, refPath: keysOf(site), readable: true };
  }
  if (site.root === 'nodes' && site.nodeId !== undefined) {
    return {
      source: site.nodeId,
      refPath: site.member === 'output' ? keysOf(site) : [],
      readable: site.member === 'output',
    };
  }
  return undefined;
}

/** The one plain reference a `forEach` list is, when it is one. */
function plainListOf(node: NodeDef, sources: readonly ExprSource[]) {
  const list = sources.find((s) => s.field === 'forEach');
  if (list?.tokens === undefined || !isSingleTemplate(list.text, list.tokens)) {
    return undefined;
  }
  const unit = list.units[0];
  if (list.units.length !== 1 || unit?.refs.length !== 1) return undefined;
  const site = unit.refs[0];
  if (
    site === undefined ||
    site.called === true ||
    site.dynamicTail === true ||
    site.range[0] !== unit.range[0] ||
    site.range[1] !== unit.range[1]
  ) {
    return undefined;
  }
  const origin = originOf(site, list.field);
  if (origin === undefined || !origin.readable || origin.source === node.id) {
    return undefined;
  }
  return origin;
}

/** Every reference of the fields `keep` takes, with where it comes from;
 * references no step or input stands behind are left out. */
function resolvedIn(
  sources: readonly ExprSource[],
  keep: (source: ExprSource) => boolean,
  options: { items?: boolean; self?: string } = {},
): Resolved[] {
  const out: Resolved[] = [];
  for (const source of sources) {
    if (!keep(source)) continue;
    for (const unit of source.units) {
      for (const site of unit.refs) {
        const reading = { source, site };
        const origin = originOf(site, source.field);
        if (origin !== undefined) {
          if (origin.source !== options.self) out.push({ reading, origin });
        } else if (site.root === 'item' && options.items === true) {
          out.push({
            reading,
            origin: { source: '', refPath: keysOf(site), readable: true },
            item: true,
          });
        }
      }
    }
  }
  return out;
}

/** What a step reads, field by field. */
function stepReads(
  node: NodeDef,
  pointer: string,
  sources: readonly ExprSource[],
): StepReads {
  const data = (s: ExprSource) => s.data && s.field !== 'forEach';
  const list = plainListOf(node, sources);
  return {
    pointer,
    when: resolvedIn(sources, (s) => s.field === 'when'),
    forEach: resolvedIn(sources, (s) => s.field === 'forEach'),
    data: resolvedIn(sources, data),
    // `item` reads travel from the list's own source, when it is one plain
    // reference; otherwise the item comes from no step.
    itemData: resolvedIn(sources, data, { items: list !== undefined }),
    repeatUntil: resolvedIn(sources, (s) => s.field === 'repeatUntil', {
      self: node.id,
    }),
  };
}

/** Whether a unit did its work (it may have failed doing it). */
function worked(record: NodeRunRecord): boolean {
  return (
    failedAndContinued(record) ||
    (record.status !== 'skipped' && record.skip === undefined)
  );
}

/** Whether a step's own condition failed to evaluate: it read the
 * condition, and nothing it would have worked on. */
function conditionFailed(
  record: NodeRunRecord | undefined,
  pointer: string,
): boolean {
  return record?.failure?.at?.pointer === `${pointer}/when`;
}

/** Whether `record` is the unit that does `node`'s work: the step itself,
 * or one item, or one pass. */
function isWorkUnit(node: NodeDef, record: NodeRunRecord): boolean {
  const { item, pass } = record.key;
  const iterates = typeof node.forEach === 'string';
  const repeats = typeof node.repeatUntil === 'string';
  if (iterates) return item >= 0 && (repeats ? pass >= 0 : pass < 0);
  if (repeats) return item < 0 && pass >= 0;
  return item < 0 && pass < 0;
}

/** When a step's condition let it through, if it has one that held. */
function gateAt(record: NodeRunRecord | undefined): number | undefined {
  return record?.decisions.findLast((d) => d.kind === 'when')?.at;
}

/**
 * Every travel of a run, the earliest first — a condition's reads ahead of
 * the work they let through when the times tie: at most
 * {@link MAX_TRAVELS}, with `total` counting them all. The work is bounded by
 * the travels kept, not by the reads a run made: reads are grouped by the
 * unit and the moment they were made, the groups ordered, and only the
 * groups that reach the answer are written out.
 */
export function deriveTravels(
  doc: Automation,
  records: readonly NodeRunRecord[],
): { travels: Travel[]; total: number } {
  const ctx = newParseCtx();
  const steps = new Map<
    string,
    { node: NodeDef; reads: StepReads; list?: Resolved['origin'] }
  >();
  for (const [index, node] of doc.nodes.entries()) {
    if (typeof node.id !== 'string' || steps.has(node.id)) continue;
    const sources = sourcesOf(node, index, ctx);
    const list = plainListOf(node, sources);
    steps.set(node.id, {
      node,
      reads: stepReads(node, `/nodes/${index}`, sources),
      ...(list !== undefined && { list }),
    });
  }
  // A canonical order, so the same records give the same travels however
  // they were read.
  const units = latestPerUnit(records).toSorted(
    (a, b) =>
      (a.key.path < b.key.path ? -1 : a.key.path > b.key.path ? 1 : 0) ||
      a.key.item - b.key.item ||
      a.key.pass - b.key.pass,
  );
  const stepRow = new Map<string, NodeRunRecord>();
  for (const record of units) {
    if (record.key.item < 0 && record.key.pass < 0) {
      stepRow.set(record.key.path, record);
    }
  }

  const groups: Group[] = [];
  let total = 0;
  const group = (
    record: NodeRunRecord,
    unitOrder: number,
    phase: number,
    at: number | undefined,
    order: boolean,
    reads: readonly Resolved[],
  ): void => {
    if (at === undefined || reads.length === 0) return;
    total += reads.length;
    groups.push({ at, order, unitOrder, phase, record, reads });
  };

  let output: Resolved[] | undefined;
  for (const [unitOrder, record] of units.entries()) {
    const path = record.key.path;
    if (path === START_PATH || record.meta.reused !== undefined) continue;
    if (path === END_PATH) {
      if (!worked(record)) continue;
      output ??= resolvedIn(outputSources(doc.output, ctx), () => true);
      group(record, unitOrder, 0, record.startedAt, false, output);
      continue;
    }
    const step = steps.get(path);
    if (step === undefined) continue;
    const { node, reads } = step;
    const own = stepRow.get(path);
    const failedAtCondition = conditionFailed(own, reads.pointer);
    if (record.key.item < 0 && record.key.pass < 0) {
      const when = gateAt(record);
      if (when !== undefined) {
        group(record, unitOrder, 0, when, true, reads.when);
      } else if (failedAtCondition) {
        // The condition was read when it failed.
        const at =
          record.decisions.findLast((d) => d.kind === 'onError')?.at ??
          record.endedAt ??
          record.startedAt;
        group(record, unitOrder, 0, at, true, reads.when);
      }
      if (
        typeof node.forEach === 'string' &&
        worked(record) &&
        !failedAtCondition
      ) {
        const at =
          record.decisions.findLast((d) => d.kind === 'forEach')?.at ??
          record.startedAt;
        group(
          record,
          unitOrder,
          1,
          at === undefined ? undefined : Math.max(at, when ?? at),
          false,
          reads.forEach,
        );
      }
    }
    if (record.key.pass >= 0) {
      const settled = record.decisions.findLast(
        (d) => d.kind === 'repeatUntil',
      );
      group(record, unitOrder, 3, settled?.at, true, reads.repeatUntil);
    }
    if (
      !isWorkUnit(node, record) ||
      !worked(record) ||
      failedAtCondition ||
      record.startedAt === undefined
    ) {
      continue;
    }
    const gate = gateAt(own);
    group(
      record,
      unitOrder,
      2,
      gate === undefined ? record.startedAt : Math.max(record.startedAt, gate),
      false,
      record.key.item >= 0 ? reads.itemData : reads.data,
    );
  }

  groups.sort(
    (a, b) =>
      a.at - b.at ||
      Number(b.order) - Number(a.order) ||
      a.unitOrder - b.unitOrder ||
      a.phase - b.phase,
  );
  const travels: Travel[] = [];
  for (const g of groups) {
    for (const resolved of g.reads) {
      if (travels.length >= MAX_TRAVELS) return { travels, total };
      travels.push(travelOf(g, resolved, steps, stepRow));
    }
  }
  return { travels, total };
}

/** One read, written out, with the value it read from the source's stored
 * value. */
function travelOf(
  g: Group,
  { reading, origin, item }: Resolved,
  steps: ReadonlyMap<string, { list?: Resolved['origin'] }>,
  stepRow: ReadonlyMap<string, NodeRunRecord>,
): Travel {
  const { record } = g;
  const list = item === true ? steps.get(record.key.path)?.list : undefined;
  const from =
    list !== undefined
      ? {
          source: list.source,
          refPath: [...list.refPath, record.key.item, ...origin.refPath],
          readable: true,
        }
      : origin;
  const fromInput = from.source === START_PATH;
  const travel: Travel = {
    from: fromInput ? { kind: 'input' } : { kind: 'node', nodeId: from.source },
    to: {
      path: record.key.path,
      field: reading.source.field,
      pointer: reading.source.pointer,
      range: [reading.site.range[0], reading.site.range[1]],
    },
    refPath: from.refPath,
    at: g.at,
    ...(record.key.item >= 0 && { item: record.key.item }),
    ...(record.key.pass >= 0 && { pass: record.key.pass }),
    edge: {
      source: from.source,
      target: record.key.path,
      kind: g.order ? 'order' : fromInput ? 'entry' : 'data',
    },
  };
  if (from.readable) {
    const value = walkRecorded(stepRow.get(from.source)?.output, from.refPath);
    if (value !== undefined) travel.value = value;
  }
  return travel;
}

/**
 * A glimpse of what `refPath` reads in a stored value, secrets withheld:
 * `redacted` where the record withheld it, `elided` where the record cut it
 * away; undefined when the value was not stored or the path leads out of
 * it. A list or text the record cut short is told at its whole length, and
 * a value with cuts inside it carries no size. A `length` read of a list or
 * a text answers its whole length.
 */
export function walkRecorded(
  record: ValueRecord | undefined,
  refPath: ReadonlyArray<string | number>,
): ValueSummary | undefined {
  if (record?.value === undefined) return undefined;
  const elided = record.elided ?? [];
  const redacted = (record.redacted ?? []).filter(
    (mark) => mark.why !== 'name',
  );
  // Past the listed marks a reader cannot tell what else was cut.
  const unsure =
    record.elidedTotal !== undefined || record.redactedTotal !== undefined;
  const withheldAt = (pointer: string): boolean =>
    redacted.some((mark) => isWithin(pointer, mark.pointer));
  const goneAt = (pointer: string): boolean =>
    elided.some(
      (cut) =>
        (cut.kind === 'depth' || cut.kind === 'whole') &&
        isWithin(pointer, cut.pointer),
    );
  const droppedAt = (pointer: string, kind: 'string' | 'items'): number =>
    elided.find((cut) => cut.kind === kind && cut.pointer === pointer)
      ?.dropped ?? 0;

  let current: unknown = record.value;
  const walked: Array<string | number> = [];
  for (const key of refPath) {
    const here = pointerOf(walked);
    if (withheldAt(here)) return { kind: 'redacted' };
    if (goneAt(here)) return { kind: 'elided' };
    if (
      key === 'length' &&
      (Array.isArray(current) || typeof current === 'string')
    ) {
      if (unsure) return undefined;
      const dropped = droppedAt(
        here,
        typeof current === 'string' ? 'string' : 'items',
      );
      current = current.length + dropped;
      walked.push(key);
      continue;
    }
    if (Array.isArray(current)) {
      const index =
        typeof key === 'number'
          ? key
          : INDEX.test(key)
            ? Number(key)
            : undefined;
      if (index === undefined || !Number.isInteger(index) || index < 0) {
        return undefined;
      }
      if (index >= current.length) {
        const dropped = droppedAt(here, 'items');
        return index < current.length + dropped
          ? { kind: 'elided' }
          : undefined;
      }
      current = current[index];
      walked.push(index);
      continue;
    }
    if (typeof current === 'object' && current !== null) {
      const name = String(key);
      if (!Object.hasOwn(current, name)) return undefined;
      current = Reflect.get(current, name);
      walked.push(name);
      continue;
    }
    return undefined;
  }
  const at = pointerOf(walked);
  if (withheldAt(at)) return { kind: 'redacted' };
  if (goneAt(at)) return { kind: 'elided' };
  const summary = recordedSummary(current);
  if (walked.at(-1) === 'length') return summary;
  const own = elided.find(
    (cut) =>
      cut.pointer === at && (cut.kind === 'string' || cut.kind === 'items'),
  );
  if (own !== undefined) {
    summary.length = (summary.length ?? 0) + own.dropped;
    if (own.kind === 'string') summary.cut = true;
  }
  if (summary.items !== undefined) {
    summary.items = summary.items.map((item, index) => {
      const child = pointerOf([...walked, index]);
      if (withheldAt(child)) return { kind: 'redacted' };
      if (goneAt(child)) return { kind: 'elided' };
      const cut = elided.find(
        (mark) =>
          mark.pointer === child &&
          (mark.kind === 'string' || mark.kind === 'items'),
      );
      return cut === undefined
        ? item
        : {
            ...item,
            length: (item.length ?? 0) + cut.dropped,
            ...(cut.kind === 'string' && { cut: true as const }),
          };
    });
  }
  if (unsure || elided.some((cut) => isWithin(cut.pointer, at))) {
    delete summary.bytes;
    if (unsure) delete summary.length;
  }
  return summary;
}
