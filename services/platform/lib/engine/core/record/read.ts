/**
 * A run read step by step: the one read model every door answers — the
 * app, the REST API, the agent tools, and the engine's own in-memory host.
 * A host reads the run's records and what it knows of the run; this
 * assembles what a reader sees from them.
 *
 * It projects the records through the shared view (`view.ts`) — the status
 * words, skip chains, counts, glimpses — and adds what needs the version's
 * document: each condition's explanation and the failure's, the data that
 * travelled between steps, and the path the run took. Each answer is held
 * to a size: the record to {@link RUN_RECORD_MAX_BYTES}, one unit to
 * {@link NODE_DETAIL_MAX_BYTES}.
 *
 * Pure and browser-safe.
 */

import { pathOf } from '@tale/ui/data/json-pointer';

import { isRecord } from '../../../utils/type-utils';
import {
  assignmentFromRun,
  flowModel,
  pathIdOf,
  possiblePaths,
} from '../analysis/flow';
import type { RenderedSpan } from '../template';
import type { Automation } from '../types';
import { compareValueRecords, type ValueComparison } from './compare';
import { explainCondition, type ExplainNode } from './explain';
import { deriveTravels, type Travel } from './travels';
import {
  END_PATH,
  type NodeRunRecord,
  START_PATH,
  type StepFailure,
  type ValueRecord,
} from './types';
import { utf8Bytes } from './value';
import {
  type NodeRunSummary,
  projectRecord,
  projectUnits,
  type RunFacts,
  shapeToDepth,
  type UnitSummary,
} from './view';

/** The wire format of a record; a reader that does not know it shows the
 * run the way it showed runs before records were kept. */
export const RUN_RECORD_FORMAT = 1;

/** A record answer stays under this as JSON (UTF-8): past it, shapes keep
 * one level, then explanations and travels are left out, then steps. */
export const RUN_RECORD_MAX_BYTES = 512 * 1024;

/** A unit's record answers at most this as JSON (UTF-8). */
export const NODE_DETAIL_MAX_BYTES = 256 * 1024;

/** Units a page answers by default, and at most. */
export const NODE_PAGE_DEFAULT = 50;
export const NODE_PAGE_MAX = 200;

/** What happened to a run between its steps, as a reader may see it: never
 * the process that saw it, nor its release. */
export interface RunEventView {
  /** Stable across reads: a reader merges what it reads since a cursor by
   * it. */
  id: string;
  at: number;
  kind: string;
  nodeId?: string;
  itemIndex?: number;
  pass?: number;
  reason?: string;
  resolution?: 'retry' | 'skip' | 'fail';
  by?: string;
}

/** A step as the record answers it: the shared projection, with the
 * explanation of each condition it evaluated and of its failure. */
export type RecordedStep = Omit<NodeRunSummary, 'decisions' | 'failure'> & {
  decisions: Array<
    NodeRunSummary['decisions'][number] & { explanation?: ExplainNode[] }
  >;
  failure?: StepFailure & { explanation?: ExplainNode[] };
};

/** One item or pass of a step, as the record answers it. */
export type RecordedUnit = Omit<UnitSummary, 'decisions' | 'failure'> &
  Pick<RecordedStep, 'decisions' | 'failure'>;

export interface RunRecordView {
  format: typeof RUN_RECORD_FORMAT;
  runId: string;
  status: string;
  version: number;
  mode: 'mock' | 'live';
  startedAt: number;
  finishedAt?: number;
  /** `trace`: recorded before rows were kept, read from the run's trace. */
  source: 'record' | 'trace';
  nodes: RecordedStep[];
  events: RunEventView[];
  eventsTotal: number;
  travels?: Travel[];
  travelsTotal?: number;
  /** The path the run took through its conditions and tolerated failures,
   * when the document's paths can be told apart. */
  path?: {
    id: string;
    assignment: Record<string, boolean>;
    stoppedAt?: string;
  };
  /** The latest write the answer reflects — a step's row or an event; pass
   * it back as `since` and merge steps by path, events by id. */
  cursor: number;
  /** What was left out to hold the answer to its size: `nodes` — steps
   * inside subautomations, then steps from the end, never the step the run
   * stopped at. */
  truncated?: {
    shapes?: true;
    explanations?: true;
    travels?: true;
    nodes?: true;
  };
}

/** A step's call to a connector or a model, as the run's ledger keeps it:
 * never the process that made it. */
export interface RunCallView {
  kind: 'connector' | 'llm';
  type: string;
  /** Counts each time the call was made again. */
  attempt: number;
  status: 'started' | 'done' | 'failed';
  startedAt: number;
  finishedAt?: number;
  failureCode?: string;
  /** A person's decision about a call whose outcome was not known. */
  resolution?: 'retry' | 'skip' | 'fail';
  resolvedBy?: string;
  resolvedAt?: number;
  /** What the call was made with, and what it answered: summarized and
   * withheld as a recorder would have. */
  input?: ValueRecord;
  output?: ValueRecord;
}

/** Where a templated text field of a unit's input landed. */
export interface RenderedField {
  /** The text's place in the stored input; null when it is not there. */
  at: string | null;
  /** Each `{{ }}` unit's range in the field, and its text's range in the
   * rendered string — spans past what was stored are left out. */
  spans: RenderedSpan[];
  /** The stored text was cut, so spans past the cut were left out. */
  cut?: true;
}

/** One unit of a run — a step, one of its items or passes — read whole. */
export type NodeRunDetail = Omit<
  UnitSummary,
  'input' | 'output' | 'decisions' | 'failure'
> &
  Pick<RecordedStep, 'decisions' | 'failure'> & {
    /** The stored values, with where they were cut or withheld. */
    input?: ValueRecord;
    output?: ValueRecord;
    /** Its templated text fields, by their pointer in the document. */
    rendered?: Record<string, RenderedField>;
    /** What it read from other steps and the run input, as it read it. */
    reads: Travel[];
    readsTotal: number;
    /** How its output differs from its input, when both are objects or
     * both are lists. */
    change?: ValueComparison;
    /** Its call to a connector or a model. */
    call?: RunCallView;
    /** What was left out to hold the answer to its size. */
    truncated?: { reads?: true; call?: true };
  };

/** A page of a step's items and passes, in item then pass order. */
export interface NodeRunPage {
  path: string;
  units: RecordedUnit[];
  /** Pass back as `cursor` for the next page; null on the last. */
  next: string | null;
}

const FINISHED = new Set(['success', 'failed', 'cancelled']);

/**
 * What the projection reads of a run as a whole: its status, whether it
 * ended, when, and the step it ended at — its failed top-level step, the
 * one still at work when it was stopped, or, for a run recorded before
 * records were kept, the step its `detail` names.
 */
export function runFactsOf(
  run: { status: string; detail?: string | null; finishedAt?: number | null },
  records: readonly NodeRunRecord[],
  now: number,
): RunFacts {
  const topLevel = records.filter(
    (r) =>
      r.key.item < 0 &&
      r.key.pass < 0 &&
      !r.key.path.includes('/') &&
      r.key.path !== START_PATH &&
      r.key.path !== END_PATH,
  );
  const wanted =
    run.status === 'failed'
      ? topLevel.find((r) => r.status === 'failed')
      : run.status === 'cancelled'
        ? topLevel.find((r) => r.status === 'running' || r.status === 'waiting')
        : undefined;
  const named =
    run.status === 'failed'
      ? run.detail?.match(/^([a-z][a-z0-9_]{0,49}): /)?.[1]
      : undefined;
  const failedNode = wanted?.key.path ?? named;
  return {
    status: run.status,
    finished: FINISHED.has(run.status),
    ...(failedNode !== undefined && { failedNode }),
    now,
    ...(run.finishedAt !== undefined &&
      run.finishedAt !== null && { finishedAt: run.finishedAt }),
  };
}

/**
 * A run's record as a reader sees it, held to its size. With `changed`,
 * only the steps it names — the steps written since a reader's cursor.
 */
export function recordView(args: {
  run: {
    id: string;
    status: string;
    version: number;
    mode: 'mock' | 'live';
    startedAt: number;
    finishedAt?: number;
  };
  source: RunRecordView['source'];
  doc: Automation;
  records: readonly NodeRunRecord[];
  facts: RunFacts;
  events: RunEventView[];
  eventsTotal: number;
  cursor: number;
  changed?: ReadonlySet<string>;
  travels?: boolean;
}): RunRecordView {
  const { doc, records, facts, changed } = args;
  const summaries = projectRecord(doc, records, facts).map((summary) =>
    explained(summary, doc),
  );
  const view: RunRecordView = {
    format: RUN_RECORD_FORMAT,
    runId: args.run.id,
    status: args.run.status,
    version: args.run.version,
    mode: args.run.mode,
    startedAt: args.run.startedAt,
    ...(args.run.finishedAt !== undefined && {
      finishedAt: args.run.finishedAt,
    }),
    source: args.source,
    nodes:
      changed === undefined
        ? summaries
        : summaries.filter((summary) => changed.has(summary.path)),
    events: args.events,
    eventsTotal: args.eventsTotal,
    cursor: args.cursor,
  };
  if (args.travels === true) {
    const travels = deriveTravels(doc, records);
    view.travels = travels.travels;
    view.travelsTotal = travels.total;
  }
  const path = pathOfRun(doc, records, facts);
  if (path !== undefined) view.path = path;
  return withinBudget(view);
}

/** A step's item and pass rows, each as the record answers it. */
export function recordedUnits(
  doc: Automation,
  records: readonly NodeRunRecord[],
  facts: RunFacts,
  path: string,
): RecordedUnit[] {
  return projectUnits(doc, records, facts, path).map((unit) =>
    explained(unit, doc),
  );
}

/** The record of one unit; undefined when the run holds none. */
export function findUnit(
  records: readonly NodeRunRecord[],
  path: string,
  item: number,
  pass: number,
): NodeRunRecord | undefined {
  return records.findLast(
    (r) => r.key.path === path && r.key.item === item && r.key.pass === pass,
  );
}

/**
 * One unit of a run read whole — a step (`item` and `pass` -1), or one of
 * its items or passes: its summary, its stored input and output, where its
 * templates' text landed, what it read and when, and how its output
 * differs from its input. Null when the record does not hold it. A host
 * that keeps a ledger adds the unit's `call` and holds the answer to its
 * size again ({@link detailWithinBudget}).
 */
export function nodeDetail(args: {
  doc: Automation;
  records: readonly NodeRunRecord[];
  facts: RunFacts;
  path: string;
  item: number;
  pass: number;
}): NodeRunDetail | null {
  const { doc, records, facts, path, item, pass } = args;
  const summary: UnitSummary | undefined =
    item < 0 && pass < 0
      ? (() => {
          const step = projectRecord(doc, records, facts).find(
            (node) => node.path === path,
          );
          return step === undefined ? undefined : { ...step, item, pass };
        })()
      : projectUnits(doc, records, facts, path).find(
          (unit) => unit.item === item && unit.pass === pass,
        );
  if (summary === undefined) return null;
  const record = findUnit(records, path, item, pass);
  const { input: _input, output: _output, ...rest } = explained(summary, doc);
  const detail: NodeRunDetail = { ...rest, reads: [], readsTotal: 0 };
  if (record?.input !== undefined) detail.input = record.input;
  if (record?.output !== undefined) detail.output = record.output;
  const rendered = renderedFields(record);
  if (rendered !== undefined) detail.rendered = rendered;
  const reads = readsOf(doc, records, path, item, pass);
  detail.reads = reads.travels;
  detail.readsTotal = reads.total;
  const change = changeOf(record);
  if (change !== undefined) detail.change = change;
  return detailWithinBudget(detail);
}

/** Whether the ledger may hold a call for a unit of its own: a step that
 * runs per item or repeats has its calls on its items and passes. */
export function unitHasOwnCall(record: NodeRunRecord): boolean {
  const { item, pass } = record.key;
  const iterates =
    record.counts !== undefined &&
    (record.counts.items > 0 || (record.counts.passes ?? 0) > 0);
  return !(item < 0 && pass < 0 && iterates);
}

/** A step with the explanation of each condition it evaluated, and of the
 * expression it failed on — read against the version's own text. */
function explained<T extends NodeRunSummary>(
  summary: T,
  doc: Automation,
): Omit<T, 'decisions' | 'failure'> &
  Pick<RecordedStep, 'decisions' | 'failure'> {
  const decisions = summary.decisions.map((decision) => {
    if (!('trace' in decision) || decision.source === undefined) {
      return decision;
    }
    return {
      ...decision,
      explanation: explainCondition(decision.source, decision.trace),
    };
  });
  const failure = summary.failure;
  if (failure?.trace === undefined) return { ...summary, decisions };
  const text = fieldText(doc, failure.trace.pointer);
  return {
    ...summary,
    decisions,
    failure:
      text === undefined
        ? failure
        : { ...failure, explanation: explainCondition(text, failure.trace) },
  };
}

/** The string at `pointer` in the document, if one is there. */
function fieldText(doc: Automation, pointer: string): string | undefined {
  let at: unknown = doc;
  try {
    for (const segment of pathOf(pointer)) {
      if (Array.isArray(at) && typeof segment === 'number') at = at[segment];
      else if (isRecord(at)) at = at[String(segment)];
      else return undefined;
    }
  } catch (error) {
    console.warn(
      `[automations] a recorded failure names an unreadable place (${pointer}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
  return typeof at === 'string' ? at : undefined;
}

/** The path the run took, when the document's paths can be told apart. */
function pathOfRun(
  doc: Automation,
  records: readonly NodeRunRecord[],
  facts: RunFacts,
): RunRecordView['path'] {
  const model = flowModel(doc.nodes);
  if (model === null || possiblePaths(model).truncated) return undefined;
  const assignment = assignmentFromRun(model, { record: records });
  return {
    id: pathIdOf(model, assignment),
    assignment,
    ...(facts.failedNode !== undefined && { stoppedAt: facts.failedNode }),
  };
}

const sizeOf = (value: unknown): number => utf8Bytes(JSON.stringify(value));

/** Hold the answer to {@link RUN_RECORD_MAX_BYTES}: shapes first, then
 * explanations, then travels, then steps. */
export function withinBudget(view: RunRecordView): RunRecordView {
  if (sizeOf(view) <= RUN_RECORD_MAX_BYTES) return view;
  const shallow: RunRecordView = {
    ...view,
    nodes: view.nodes.map((node) => ({
      ...node,
      ...(node.input !== undefined && {
        input: { ...node.input, shape: shapeToDepth(node.input.shape, 1) },
      }),
      ...(node.output !== undefined && {
        output: { ...node.output, shape: shapeToDepth(node.output.shape, 1) },
      }),
    })),
    truncated: { ...view.truncated, shapes: true },
  };
  if (sizeOf(shallow) <= RUN_RECORD_MAX_BYTES) return shallow;
  const plain: RunRecordView = {
    ...shallow,
    nodes: shallow.nodes.map((node) => ({
      ...node,
      decisions: node.decisions.map(
        ({ explanation: _explanation, ...decision }) => decision,
      ),
      ...(node.failure !== undefined && {
        failure: (({ explanation: _explanation, ...failure }) => failure)(
          node.failure,
        ),
      }),
    })),
    truncated: { ...shallow.truncated, explanations: true },
  };
  if (sizeOf(plain) <= RUN_RECORD_MAX_BYTES) return plain;
  if (plain.travels === undefined) return fewerSteps(plain);
  const { travels: _travels, ...withoutTravels } = plain;
  return fewerSteps({
    ...withoutTravels,
    truncated: { ...plain.truncated, travels: true },
  });
}

/** Leave steps out until the answer fits: steps inside subautomations
 * first, then steps from the end — never the step the run stopped at. */
function fewerSteps(view: RunRecordView): RunRecordView {
  if (sizeOf(view) <= RUN_RECORD_MAX_BYTES) return view;
  const weight = (node: RecordedStep): number =>
    node.path === view.path?.stoppedAt
      ? 0
      : node.parentPath === undefined
        ? 1
        : 2;
  const kept = view.nodes
    .map((node, index) => ({ node, index }))
    .toSorted((x, y) => weight(x.node) - weight(y.node) || x.index - y.index);
  let count = kept.length;
  let fitted = view;
  while (count > 1 && sizeOf(fitted) > RUN_RECORD_MAX_BYTES) {
    count = Math.floor(count * 0.75);
    const keep = new Set(kept.slice(0, count).map((entry) => entry.index));
    fitted = {
      ...view,
      nodes: view.nodes.filter((_, index) => keep.has(index)),
      truncated: { ...view.truncated, nodes: true },
    };
  }
  return fitted;
}

/** The rendered spans a unit's record keeps, placed in its stored input. */
function renderedFields(
  record: NodeRunRecord | undefined,
): Record<string, RenderedField> | undefined {
  const rendered = record?.meta.rendered;
  if (rendered === undefined || record === undefined) return undefined;
  const out: Record<string, RenderedField> = {};
  for (const [field, spans] of Object.entries(rendered)) {
    const at = inputPointerOf(field);
    const text = at === null ? undefined : storedText(record.input, at);
    const kept =
      text === undefined
        ? spans
        : spans.filter((span) => span.out[1] <= text.length);
    const cut =
      at !== null &&
      (record.input?.elided ?? []).some(
        (mark) => mark.kind === 'string' && mark.pointer === at,
      );
    out[field] = {
      at: text === undefined ? null : at,
      spans: kept.map((span) => ({
        unit: [span.unit[0], span.unit[1]],
        out: [span.out[0], span.out[1]],
      })),
      ...(cut && { cut: true as const }),
    };
  }
  return out;
}

/** Where a field of a step's document sits in the input it recorded: a
 * field under `input` at its place in the input, any other field (a
 * prompt, a system text) under its own name. */
function inputPointerOf(field: string): string | null {
  const match = /^(?:\/nodes\/\d+)(\/.*)$/.exec(field);
  if (match === null) return null;
  const rest = match[1] ?? '';
  return rest.startsWith('/input/') ? rest.slice('/input'.length) : rest;
}

/** The text at `pointer` in a stored value; undefined when no text is
 * stored there. */
function storedText(
  record: ValueRecord | undefined,
  pointer: string,
): string | undefined {
  let at: unknown = record?.value;
  for (const segment of pathOf(pointer)) {
    if (Array.isArray(at) && typeof segment === 'number') at = at[segment];
    else if (isRecord(at)) at = at[String(segment)];
    else return undefined;
  }
  return typeof at === 'string' ? at : undefined;
}

/** What one unit read, from the records of the steps it may read. */
function readsOf(
  doc: Automation,
  records: readonly NodeRunRecord[],
  path: string,
  item: number,
  pass: number,
): { travels: Travel[]; total: number } {
  // A unit reads steps and the run input: their own rows, and its own.
  const relevant = records.filter(
    (r) =>
      (r.key.item < 0 && r.key.pass < 0) ||
      (r.key.path === path && r.key.item === item && r.key.pass === pass),
  );
  const travels = deriveTravels(doc, relevant).travels.filter(
    (travel) =>
      travel.edge.target === path &&
      (travel.item ?? -1) === item &&
      (travel.pass ?? -1) === pass,
  );
  return { travels, total: travels.length };
}

/** How a unit's output differs from its input, when the two are alike
 * enough to compare: both objects, or both lists. */
function changeOf(
  record: NodeRunRecord | undefined,
): ValueComparison | undefined {
  const kind = record?.input?.summary.kind;
  if (
    record?.input === undefined ||
    record.output === undefined ||
    (kind !== 'object' && kind !== 'array') ||
    record.output.summary.kind !== kind
  ) {
    return undefined;
  }
  return compareValueRecords(record.input, record.output);
}

/** Hold a unit's answer to {@link NODE_DETAIL_MAX_BYTES}: its call's values
 * first, then what it read. */
export function detailWithinBudget(detail: NodeRunDetail): NodeRunDetail {
  if (sizeOf(detail) <= NODE_DETAIL_MAX_BYTES) return detail;
  let fitted = detail;
  if (detail.call !== undefined) {
    const { input: _input, output: _output, ...call } = detail.call;
    fitted = {
      ...detail,
      call,
      truncated: { ...detail.truncated, call: true },
    };
    if (sizeOf(fitted) <= NODE_DETAIL_MAX_BYTES) return fitted;
  }
  let count = fitted.reads.length;
  while (count > 0 && sizeOf(fitted) > NODE_DETAIL_MAX_BYTES) {
    count = Math.floor(count / 2);
    fitted = {
      ...fitted,
      reads: fitted.reads.slice(0, count),
      truncated: { ...fitted.truncated, reads: true },
    };
  }
  return fitted;
}
