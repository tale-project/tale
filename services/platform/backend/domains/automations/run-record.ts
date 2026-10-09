import { pathOf } from '@tale/ui/data/json-pointer';
import type { Sql } from 'postgres';

import {
  assignmentFromRun,
  flowModel,
  pathIdOf,
  possiblePaths,
} from '../../../lib/engine/core/analysis/flow.ts';
import {
  compareRuns,
  type CompareEffect,
  type CompareRun,
  compareValueRecords,
  type RunDiff,
  type ValueComparison,
} from '../../../lib/engine/core/record/compare.ts';
import {
  explainCondition,
  type ExplainNode,
} from '../../../lib/engine/core/record/explain.ts';
import {
  deriveTravels,
  type Travel,
} from '../../../lib/engine/core/record/travels.ts';
import {
  END_PATH,
  type NodeRunRecord,
  START_PATH,
  type StepFailure,
  type ValueRecord,
} from '../../../lib/engine/core/record/types.ts';
import {
  recordValue,
  unlimitedBudget,
  utf8Bytes,
} from '../../../lib/engine/core/record/value.ts';
import {
  type NodeRunSummary,
  projectRecord,
  projectUnits,
  type RunFacts,
  shapeToDepth,
  type UnitSummary,
} from '../../../lib/engine/core/record/view.ts';
import type { RenderedSpan } from '../../../lib/engine/core/template.ts';
import type {
  Automation,
  Effect,
  NodeTrace,
} from '../../../lib/engine/core/types.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { parseRunCheckpoints } from '../../core/automations/checkpoints.ts';
import { nodeRunFromRow, readNodeRunsSince } from './node-runs.ts';
import { AutomationError, versionRow } from './store.ts';

/**
 * The read model of a run's record: what the app, the REST API and the
 * agent tools answer when someone reads a run step by step. One reading,
 * three doors — each door checks who may read the run, then asks here.
 *
 * It reads the run's stored rows (`node-runs.ts`), projects them through the
 * engine's pure view (`record/view.ts`) — the shared status words, skip
 * chains, counts, summaries — and adds what needs the version's document:
 * each condition's explanation, the failure's, the travels of data between
 * steps, and the path the run took. A run recorded before rows were kept is
 * read from its trace and checkpoints instead, its values summarized and
 * withheld as a recorder would have.
 */

/** The wire format of a record; a reader that does not know it shows the
 * run the way it showed runs before records were kept. */
export const RUN_RECORD_FORMAT = 1;

/** A record answer stays under this as JSON (UTF-8): past it, shapes keep
 * one level, then explanations and travels are left out, then steps. */
export const RUN_RECORD_MAX_BYTES = 512 * 1024;

/** Run events kept per answer, oldest first. */
const RUN_EVENTS_MAX = 200;

/** The events a reader sees; the rest are the engine's own bookkeeping. */
const EVENT_KINDS = [
  'taken_over',
  'handed_off',
  'lease_expired',
  'node_interrupted',
  'in_doubt',
  'in_doubt_resolved',
  'engine_deferred',
  'legacy_stop_requested',
];

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

interface RunRow {
  name: string;
  version: number;
  status: string;
  mode: 'mock' | 'live';
  input: unknown;
  output: unknown;
  checkpoints: unknown;
  trace: unknown;
  effects: unknown;
  detail: string | null;
  failureCode: string | null;
  startedAt: number;
  finishedAt: number | null;
}

const FINISHED = new Set(['success', 'failed', 'cancelled']);

/** A run as its reads need it: its row and the document of the version it
 * executed. */
interface LoadedRun {
  run: RunRow;
  doc: Automation;
}

async function loadRun(
  sql: Sql,
  organizationId: string,
  runId: string,
): Promise<LoadedRun | null> {
  const runs = await sql<RunRow[]>`
    SELECT name, version, status, mode, input, output, checkpoints, trace,
           effects, detail, failure_code AS "failureCode",
           started_at_ms::float8 AS "startedAt",
           finished_at_ms::float8 AS "finishedAt"
    FROM app.automation_runs
    WHERE id = ${runId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  const run = runs[0];
  if (run === undefined) return null;
  const version = await versionRow(sql, organizationId, run.name, run.version);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- documents are validated before they are saved
  const doc = (version?.document ?? { nodes: [] }) as Automation;
  return { run, doc };
}

/** What the projection reads of the run as a whole. */
function runFacts(run: RunRow, records: readonly NodeRunRecord[]): RunFacts {
  return {
    status: run.status,
    finished: FINISHED.has(run.status),
    ...failedNodeOf(run, records),
    now: Date.now(),
    ...(run.finishedAt !== null && { finishedAt: run.finishedAt }),
  };
}

/** Every record of a run: its stored rows, or, for a run recorded before
 * rows were kept, what its trace says. */
async function recordsOf(
  sql: Sql,
  organizationId: string,
  runId: string,
  run: RunRow,
): Promise<{
  records: NodeRunRecord[];
  stored: Array<{ record: NodeRunRecord; updatedAt: number }>;
  legacy: boolean;
}> {
  const stored = await readNodeRunsSince(sql, organizationId, runId);
  const legacy = stored.length === 0;
  return {
    records: legacy ? recordsFromTrace(run) : stored.map((row) => row.record),
    stored,
    legacy,
  };
}

/**
 * The record of one run, or null when the run is not this organization's.
 * With `since`, only the steps with a row written at or after it, and the
 * events since, are answered — the reader merges them by step.
 */
export async function readRunRecord(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    since?: number;
    travels?: boolean;
  },
): Promise<RunRecordView | null> {
  const loaded = await loadRun(sql, args.organizationId, args.runId);
  if (loaded === null) return null;
  const { run, doc } = loaded;
  const { records, stored, legacy } = await recordsOf(
    sql,
    args.organizationId,
    args.runId,
    run,
  );
  const facts = runFacts(run, records);
  const summaries = projectRecord(doc, records, facts).map((summary) =>
    explained(summary, doc),
  );
  const changed =
    args.since === undefined ? undefined : changedSteps(stored, args.since);
  const nodes =
    changed === undefined
      ? summaries
      : summaries.filter((summary) => changed.has(summary.path));
  const events = await readEvents(sql, args, args.since);
  const cursor = Math.max(
    stored.reduce((max, row) => Math.max(max, row.updatedAt), 0),
    events.events.at(-1)?.at ?? 0,
  );
  const view: RunRecordView = {
    format: RUN_RECORD_FORMAT,
    runId: args.runId,
    status: run.status,
    version: run.version,
    mode: run.mode,
    startedAt: run.startedAt,
    ...(run.finishedAt !== null && { finishedAt: run.finishedAt }),
    source: legacy ? 'trace' : 'record',
    nodes,
    events: events.events,
    eventsTotal: events.total,
    cursor,
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

/** The step a run ended at: its failed top-level step, or the one still at
 * work when it was stopped. */
function failedNodeOf(
  run: RunRow,
  records: readonly NodeRunRecord[],
): Pick<RunFacts, 'failedNode'> {
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
  if (wanted !== undefined) return { failedNode: wanted.key.path };
  // A run recorded before rows were kept names its failed step in `detail`.
  const named = run.detail?.match(/^([a-z][a-z0-9_]{0,49}): /)?.[1];
  return run.status === 'failed' && named !== undefined
    ? { failedNode: named }
    : {};
}

/** The steps any of whose rows were written at or after `since`. */
function changedSteps(
  stored: ReadonlyArray<{ record: NodeRunRecord; updatedAt: number }>,
  since: number,
): Set<string> {
  const changed = new Set<string>();
  for (const row of stored) {
    if (row.updatedAt >= since) changed.add(row.record.key.path);
  }
  return changed;
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

/** The run's events as a reader may see them, oldest first. */
async function readEvents(
  sql: Sql,
  args: { organizationId: string; runId: string },
  since: number | undefined,
): Promise<{ events: RunEventView[]; total: number }> {
  const rows = await sql<
    { id: string; at: number; kind: string; detail: unknown; total: number }[]
  >`
    SELECT id, at_ms::float8 AS at, kind, detail,
           count(*) OVER ()::int AS total
    FROM app.automation_run_events
    WHERE run_id = ${args.runId} AND org_id = ${args.organizationId}
      AND kind = ANY(${EVENT_KINDS}::text[])
      AND (${since ?? null}::bigint IS NULL OR at_ms >= ${since ?? null})
    ORDER BY at_ms, id
    LIMIT ${RUN_EVENTS_MAX}
  `;
  return {
    events: rows.map((row) => eventView(row)),
    total: rows[0]?.total ?? 0,
  };
}

/** An event with only what a reader may see of its detail: where in the
 * run it happened, why, and what a person decided. */
export function eventView(row: {
  id: string;
  at: number;
  kind: string;
  detail: unknown;
}): RunEventView {
  const { detail } = row;
  const view: RunEventView = { id: row.id, at: row.at, kind: row.kind };
  if (!isRecord(detail)) return view;
  const nodeId = detail.path ?? detail.nodeId;
  if (typeof nodeId === 'string') view.nodeId = nodeId;
  if (typeof detail.itemIndex === 'number') view.itemIndex = detail.itemIndex;
  if (typeof detail.pass === 'number') view.pass = detail.pass;
  if (typeof detail.reason === 'string') view.reason = detail.reason;
  if (
    detail.resolution === 'retry' ||
    detail.resolution === 'skip' ||
    detail.resolution === 'fail'
  ) {
    view.resolution = detail.resolution;
  }
  const by = detail.resolvedBy ?? detail.by;
  if (typeof by === 'string') view.by = by;
  return view;
}

/** The record of a run recorded before rows were kept: its input, each
 * step its trace names, and its output — values summarized and withheld as
 * a recorder would have. */
function recordsFromTrace(run: RunRow): NodeRunRecord[] {
  const budget = unlimitedBudget();
  const unit = (
    path: string,
    nodeType: string,
    status: NodeRunRecord['status'],
  ): NodeRunRecord => ({
    key: { path, item: -1, pass: -1 },
    nodeId: path,
    nodeType,
    status,
    activeMs: 0,
    attempt: 1,
    attempts: [],
    decisions: [],
    waits: [],
    meta: {},
  });
  const records: NodeRunRecord[] = [];
  const start = unit(START_PATH, 'input', 'ok');
  start.startedAt = run.startedAt;
  start.endedAt = run.startedAt;
  start.output = recordValue(run.input, 'node', budget);
  records.push(start);
  const parsed = parseRunCheckpoints(run.checkpoints);
  const checkpoints = parsed.ok ? parsed.checkpoints.nodes : {};
  for (const entry of traceEntries(run, checkpoints)) {
    if (entry.status === 'not_run') continue;
    const checkpoint = checkpoints[entry.node];
    const status: NodeRunRecord['status'] =
      entry.status === 'ok'
        ? 'ok'
        : entry.status === 'skipped' ||
            (entry.status === 'error' && checkpoint?.reason === 'error')
          ? 'skipped'
          : 'failed';
    const record = unit(entry.node, entry.type, status);
    record.activeMs = Math.round(entry.ms ?? 0);
    const reason = checkpoint?.reason;
    if (status === 'skipped' && reason !== undefined) {
      record.skip = { reason };
    }
    if (entry.input !== undefined) {
      record.input = recordValue(entry.input, 'node', budget);
    }
    if (entry.output !== undefined) {
      record.output = recordValue(entry.output, 'node', budget);
    }
    if (entry.error !== undefined) {
      record.failure = {
        code: run.failureCode ?? 'node_error',
        reason: 'UNKNOWN',
        params: {},
        message: entry.error,
      };
    }
    records.push(record);
  }
  if (run.status === 'success') {
    const end = unit(END_PATH, 'output', 'ok');
    if (run.finishedAt !== null) {
      end.startedAt = run.finishedAt;
      end.endedAt = run.finishedAt;
    }
    end.output = recordValue(run.output, 'node', budget);
    records.push(end);
  }
  return records;
}

/** The trace a legacy run carries: its finished trace, or what its
 * checkpoints recorded so far. */
function traceEntries(
  run: RunRow,
  checkpoints: Record<string, { trace: NodeTrace }>,
): NodeTrace[] {
  if (Array.isArray(run.trace) && run.trace.length > 0) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the run's trace is written by the stepper as NodeTrace[]
    return run.trace as NodeTrace[];
  }
  return Object.values(checkpoints).map((checkpoint) => checkpoint.trace);
}

const sizeOf = (view: RunRecordView): number => utf8Bytes(JSON.stringify(view));

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

/** A unit's record answers at most this as JSON (UTF-8). */
export const NODE_DETAIL_MAX_BYTES = 256 * 1024;

/** Units a page answers by default, and at most. */
export const NODE_PAGE_DEFAULT = 50;
export const NODE_PAGE_MAX = 200;

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
  units: Array<
    Omit<UnitSummary, 'decisions' | 'failure'> &
      Pick<RecordedStep, 'decisions' | 'failure'>
  >;
  /** Pass back as `cursor` for the next page; null on the last. */
  next: string | null;
}

/**
 * One unit of a run read whole: its summary, its stored input and output,
 * where its templates' text landed, what it read and when, how its output
 * differs from its input, and its call to a connector or a model. Null when
 * the run is not this organization's, or the unit is not in its record.
 * `item` and `pass` are -1 for the step itself.
 */
export async function readNodeDetail(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    path: string;
    item?: number;
    pass?: number;
  },
): Promise<NodeRunDetail | null> {
  const item = args.item ?? -1;
  const pass = args.pass ?? -1;
  const loaded = await loadRun(sql, args.organizationId, args.runId);
  if (loaded === null) return null;
  const { run, doc } = loaded;
  const { records } = await recordsOf(
    sql,
    args.organizationId,
    args.runId,
    run,
  );
  const facts = runFacts(run, records);
  const summary: UnitSummary | undefined =
    item < 0 && pass < 0
      ? (() => {
          const step = projectRecord(doc, records, facts).find(
            (node) => node.path === args.path,
          );
          return step === undefined ? undefined : { ...step, item, pass };
        })()
      : projectUnits(doc, records, facts, args.path).find(
          (unit) => unit.item === item && unit.pass === pass,
        );
  if (summary === undefined) return null;
  const record = records.findLast(
    (r) =>
      r.key.path === args.path && r.key.item === item && r.key.pass === pass,
  );
  const { input: _input, output: _output, ...rest } = explained(summary, doc);
  const detail: NodeRunDetail = { ...rest, reads: [], readsTotal: 0 };
  if (record?.input !== undefined) detail.input = record.input;
  if (record?.output !== undefined) detail.output = record.output;
  const rendered = renderedFields(record);
  if (rendered !== undefined) detail.rendered = rendered;
  const reads = readsOf(doc, records, args.path, item, pass);
  detail.reads = reads.travels;
  detail.readsTotal = reads.total;
  const change = changeOf(record);
  if (change !== undefined) detail.change = change;
  if (record !== undefined) {
    const call = await readCall(sql, args, record);
    if (call !== undefined) detail.call = call;
  }
  return detailWithinBudget(detail);
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

interface CallRow {
  kind: 'connector' | 'llm';
  type: string;
  attempt: number;
  status: 'started' | 'done' | 'failed';
  input: unknown;
  output: unknown;
  failureCode: string | null;
  resolution: 'retry' | 'skip' | 'fail' | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
  startedAt: number;
  finishedAt: number | null;
}

/** The ledger's call for a unit. The ledger keys a step that neither runs
 * per item nor repeats at item 0, pass 0, where the record keys it -1; the
 * step row of one that does has no call of its own — its items and passes
 * do. */
async function readCall(
  sql: Sql,
  args: { organizationId: string; runId: string; path: string },
  record: NodeRunRecord,
): Promise<RunCallView | undefined> {
  const { item, pass } = record.key;
  const iterates =
    record.counts !== undefined &&
    (record.counts.items > 0 || (record.counts.passes ?? 0) > 0);
  if (item < 0 && pass < 0 && iterates) return undefined;
  const rows = await sql<CallRow[]>`
    SELECT kind, node_type AS type, attempt, status, input, output,
           failure_code AS "failureCode", resolution,
           resolved_by AS "resolvedBy",
           resolved_at_ms::float8 AS "resolvedAt",
           started_at_ms::float8 AS "startedAt",
           finished_at_ms::float8 AS "finishedAt"
    FROM app.automation_node_attempts
    WHERE run_id = ${args.runId} AND org_id = ${args.organizationId}
      AND node_id = ${args.path}
      AND item_index = ${Math.max(0, item)} AND pass = ${Math.max(0, pass)}
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) return undefined;
  const budget = unlimitedBudget();
  return {
    kind: row.kind,
    type: row.type,
    attempt: row.attempt,
    status: row.status,
    startedAt: row.startedAt,
    ...(row.finishedAt !== null && { finishedAt: row.finishedAt }),
    ...(row.failureCode !== null && { failureCode: row.failureCode }),
    ...(row.resolution !== null && { resolution: row.resolution }),
    ...(row.resolvedBy !== null && { resolvedBy: row.resolvedBy }),
    ...(row.resolvedAt !== null && { resolvedAt: row.resolvedAt }),
    ...(row.input !== null && {
      input: recordValue(row.input, 'node', budget),
    }),
    ...(row.output !== null && {
      output: recordValue(row.output, 'node', budget),
    }),
  };
}

/** Hold a unit's answer to {@link NODE_DETAIL_MAX_BYTES}: its call's values
 * first, then what it read. */
function detailWithinBudget(detail: NodeRunDetail): NodeRunDetail {
  const size = (d: NodeRunDetail): number => utf8Bytes(JSON.stringify(d));
  if (size(detail) <= NODE_DETAIL_MAX_BYTES) return detail;
  let fitted = detail;
  if (detail.call !== undefined) {
    const { input: _input, output: _output, ...call } = detail.call;
    fitted = {
      ...detail,
      call,
      truncated: { ...detail.truncated, call: true },
    };
    if (size(fitted) <= NODE_DETAIL_MAX_BYTES) return fitted;
  }
  let count = fitted.reads.length;
  while (count > 0 && size(fitted) > NODE_DETAIL_MAX_BYTES) {
    count = Math.floor(count / 2);
    fitted = {
      ...fitted,
      reads: fitted.reads.slice(0, count),
      truncated: { ...fitted.truncated, reads: true },
    };
  }
  return fitted;
}

/** A page cursor: the last unit's item and pass. */
const CURSOR = /^(-?\d{1,9}):(-?\d{1,9})$/;

/**
 * A page of a step's items and passes, in item then pass order: `cursor`
 * is the `next` of the page before, `status` keeps only the units that
 * failed. Null when the run is not this organization's; an unreadable
 * cursor is refused.
 */
export async function readNodePage(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    path: string;
    cursor?: string;
    limit?: number;
    status?: 'all' | 'failed';
  },
): Promise<NodeRunPage | null> {
  const after = args.cursor === undefined ? null : CURSOR.exec(args.cursor);
  if (args.cursor !== undefined && after === null) {
    throw new AutomationError(
      'INVALID_CURSOR',
      'this cursor does not name a place in the list',
      400,
    );
  }
  const limit = Math.min(
    NODE_PAGE_MAX,
    Math.max(1, Math.floor(args.limit ?? NODE_PAGE_DEFAULT)),
  );
  const loaded = await loadRun(sql, args.organizationId, args.runId);
  if (loaded === null) return null;
  const { run, doc } = loaded;
  const afterItem = after === null ? null : Number(after[1]);
  const afterPass = after === null ? null : Number(after[2]);
  const failedOnly = args.status === 'failed';
  const rows = await sql<Parameters<typeof nodeRunFromRow>[0][]>`
    SELECT path, item_index, pass, node_id, node_type, status,
           started_at_ms::float8 AS started_at_ms,
           ended_at_ms::float8 AS ended_at_ms, active_ms, attempt,
           skip_reason, failure_code, input, output, record
    FROM app.automation_node_runs
    WHERE run_id = ${args.runId} AND org_id = ${args.organizationId}
      AND path = ${args.path} AND (item_index >= 0 OR pass >= 0)
      AND (${afterItem}::int IS NULL
        OR (item_index, pass) > (${afterItem}::int, ${afterPass}::int))
      AND (NOT ${failedOnly}::boolean
        OR status = 'failed' OR skip_reason = 'error')
    ORDER BY item_index, pass
    LIMIT ${limit + 1}
  `;
  const records = rows.slice(0, limit).map(nodeRunFromRow);
  const facts = runFacts(run, records);
  const units = projectUnits(doc, records, facts, args.path).map((unit) =>
    explained(unit, doc),
  );
  const last = units.at(-1);
  return {
    path: args.path,
    units,
    next:
      rows.length > limit && last !== undefined
        ? `${last.item}:${last.pass}`
        : null,
  };
}

/**
 * Two runs of one automation side by side (`compareRuns`). Null when either
 * is not this organization's; two runs of different automations are
 * refused (`RUN_COMPARE_MISMATCH`).
 */
export async function readRunComparison(
  sql: Sql,
  args: { organizationId: string; runId: string; otherRunId: string },
): Promise<RunDiff | null> {
  const [a, b] = await Promise.all([
    loadRun(sql, args.organizationId, args.runId),
    loadRun(sql, args.organizationId, args.otherRunId),
  ]);
  if (a === null || b === null) return null;
  if (a.run.name !== b.run.name) {
    throw new AutomationError(
      'RUN_COMPARE_MISMATCH',
      'only two runs of the same automation can be compared',
      400,
    );
  }
  const side = async (id: string, loaded: LoadedRun): Promise<CompareRun> => {
    const { records } = await recordsOf(
      sql,
      args.organizationId,
      id,
      loaded.run,
    );
    return {
      id,
      version: loaded.run.version,
      mode: loaded.run.mode,
      status: loaded.run.status,
      startedAt: loaded.run.startedAt,
      ...(loaded.run.finishedAt !== null && {
        finishedAt: loaded.run.finishedAt,
      }),
      document: loaded.doc,
      records,
      effects: effectsOf(loaded.run.effects),
    };
  };
  const [runA, runB] = await Promise.all([
    side(args.runId, a),
    side(args.otherRunId, b),
  ]);
  return compareRuns(runA, runB);
}

/** A run's side effects as the stepper stored them; an entry that does not
 * read as one is left out. */
function effectsOf(value: unknown): CompareEffect[] {
  if (!Array.isArray(value)) return [];
  const out: CompareEffect[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { node, connector, item, pass } = entry as Partial<Effect>;
    if (typeof node !== 'string' || typeof connector !== 'string') continue;
    out.push({
      node,
      connector,
      input: entry.input,
      ...(typeof item === 'number' && { item }),
      ...(typeof pass === 'number' && { pass }),
    });
  }
  return out;
}
