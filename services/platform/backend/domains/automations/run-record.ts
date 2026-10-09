import { pathOf } from '@tale/ui/data/json-pointer';
import type { Sql } from 'postgres';

import {
  assignmentFromRun,
  flowModel,
  pathIdOf,
  possiblePaths,
} from '../../../lib/engine/core/analysis/flow.ts';
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
} from '../../../lib/engine/core/record/types.ts';
import {
  recordValue,
  unlimitedBudget,
  utf8Bytes,
} from '../../../lib/engine/core/record/value.ts';
import {
  type NodeRunSummary,
  projectRecord,
  type RunFacts,
  shapeToDepth,
} from '../../../lib/engine/core/record/view.ts';
import type { Automation, NodeTrace } from '../../../lib/engine/core/types.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { parseRunCheckpoints } from '../../core/automations/checkpoints.ts';
import { readNodeRunsSince } from './node-runs.ts';
import { versionRow } from './store.ts';

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
  detail: string | null;
  failureCode: string | null;
  startedAt: number;
  finishedAt: number | null;
}

const FINISHED = new Set(['success', 'failed', 'cancelled']);

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
  const runs = await sql<RunRow[]>`
    SELECT name, version, status, mode, input, output, checkpoints, trace,
           detail, failure_code AS "failureCode",
           started_at_ms::float8 AS "startedAt",
           finished_at_ms::float8 AS "finishedAt"
    FROM app.automation_runs
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
    LIMIT 1
  `;
  const run = runs[0];
  if (run === undefined) return null;
  const version = await versionRow(
    sql,
    args.organizationId,
    run.name,
    run.version,
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- documents are validated before they are saved
  const doc = (version?.document ?? { nodes: [] }) as Automation;
  const stored = await readNodeRunsSince(sql, args.organizationId, args.runId);
  const legacy = stored.length === 0;
  const records = legacy
    ? recordsFromTrace(run)
    : stored.map((row) => row.record);
  const facts: RunFacts = {
    status: run.status,
    finished: FINISHED.has(run.status),
    ...failedNodeOf(run, records),
    now: Date.now(),
    ...(run.finishedAt !== null && { finishedAt: run.finishedAt }),
  };
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
function explained(summary: NodeRunSummary, doc: Automation): RecordedStep {
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
