import type { Sql } from 'postgres';

import {
  type CompareEffect,
  type CompareRun,
  compareRuns,
  type RunDiff,
} from '../../../lib/engine/core/record/compare.ts';
import {
  detailWithinBudget,
  findUnit,
  NODE_PAGE_DEFAULT,
  NODE_PAGE_MAX,
  type NodeRunDetail,
  nodeDetail,
  type NodeRunPage,
  recordedUnits,
  recordView,
  type RunCallView,
  type RunEventView,
  runFactsOf,
  type RunRecordView,
  unitHasOwnCall,
} from '../../../lib/engine/core/record/read.ts';
import {
  END_PATH,
  type NodeRunRecord,
  START_PATH,
} from '../../../lib/engine/core/record/types.ts';
import {
  recordValue,
  unlimitedBudget,
} from '../../../lib/engine/core/record/value.ts';
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
 * Where a run's record is read from: the run's row, the version's
 * document, its stored rows (`node-runs.ts`), its events and its ledger.
 * What a reader sees of them is the engine's one read model
 * (`lib/engine/core/record/read.ts`), which the app, the REST API and the
 * agent tools all answer through; each door checks who may read the run,
 * then asks here. A run recorded before rows were kept is read from its
 * trace and checkpoints instead, its values summarized and withheld as a
 * recorder would have.
 */

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
  const events = await readEvents(sql, args, args.since);
  const cursor = Math.max(
    stored.reduce((max, row) => Math.max(max, row.updatedAt), 0),
    events.events.at(-1)?.at ?? 0,
  );
  return recordView({
    run: {
      id: args.runId,
      status: run.status,
      version: run.version,
      mode: run.mode,
      startedAt: run.startedAt,
      ...(run.finishedAt !== null && { finishedAt: run.finishedAt }),
    },
    source: legacy ? 'trace' : 'record',
    doc,
    records,
    facts: runFactsOf(run, records, Date.now()),
    events: events.events,
    eventsTotal: events.total,
    cursor,
    ...(args.since !== undefined && {
      changed: changedSteps(stored, args.since),
    }),
    ...(args.travels === true && { travels: true }),
  });
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

/**
 * One unit of a run read whole (`nodeDetail`), with its call in the run's
 * ledger. Null when the run is not this organization's, or the unit is not
 * in its record. `item` and `pass` are -1 for the step itself.
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
  const detail = nodeDetail({
    doc,
    records,
    facts: runFactsOf(run, records, Date.now()),
    path: args.path,
    item,
    pass,
  });
  if (detail === null) return null;
  const record = findUnit(records, args.path, item, pass);
  const call =
    record === undefined || !unitHasOwnCall(record)
      ? undefined
      : await readCall(sql, args, record);
  return call === undefined ? detail : detailWithinBudget({ ...detail, call });
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
 * per item nor repeats at item 0, pass 0, where the record keys it -1. */
async function readCall(
  sql: Sql,
  args: { organizationId: string; runId: string; path: string },
  record: NodeRunRecord,
): Promise<RunCallView | undefined> {
  const { item, pass } = record.key;
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
  const units = recordedUnits(
    doc,
    records,
    runFactsOf(run, records, Date.now()),
    args.path,
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
