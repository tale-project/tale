import type { Sql, TransactionSql } from 'postgres';

import {
  createRecorder,
  type NodeRunWrite,
} from '../../../lib/engine/core/record/recorder.ts';
import {
  type NodeRunRecord,
  START_PATH,
  type ValueRecord,
} from '../../../lib/engine/core/record/types.ts';
import { recordBudget } from '../../../lib/engine/core/record/value.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { jsonParam } from '../../db/sql.ts';
import { emitRunHint } from './store.ts';
import { markAutomationWriterInTx } from './writer-protocol.ts';

/**
 * The run record's store (`app.automation_node_runs`, migration 0190): one
 * row per unit of work of a run — a step, an item of a step that runs per
 * item, a pass of a step that repeats, a step of a subautomation it walked,
 * and the run's input and output.
 *
 * Rows ride the writes that already commit a run's progress: a progress
 * commit, a park, a hand-off and the finish each pass the rows their walker
 * changed since the last one, and those rows are written in the same
 * transaction once the run's own fenced update matched — so nothing is
 * recorded for progress that was not committed, and a walker that lost its
 * run records nothing. Rows are replaced whole, and an older walker's late
 * write never overwrites a newer walker's (`claim_epoch`).
 *
 * The one write of its own is {@link recordNodeRunsStarted}: a long step
 * (anything but a transform, or a step that iterates) says it started, with
 * what it works on, so a live view can show it working.
 */

/** Rows an earlier turn left running or waiting, read back for the next. */
const OPEN_ROWS_READ = 50;

/** A record's row, as the table holds it. */
interface NodeRunRow {
  path: string;
  item_index: number;
  pass: number;
  node_id: string;
  node_type: string;
  status: NodeRunRecord['status'];
  started_at_ms: number | null;
  ended_at_ms: number | null;
  active_ms: number;
  attempt: number;
  skip_reason: string | null;
  failure_code: string | null;
  input: ValueRecord | null;
  output: ValueRecord | null;
  record: Record<string, unknown>;
}

/** The record as its row: the columns a read filters or orders on, the two
 * values, and the rest in `record`. */
export function nodeRunRowOf(record: NodeRunRecord): NodeRunRow {
  return {
    path: record.key.path,
    item_index: record.key.item,
    pass: record.key.pass,
    node_id: record.nodeId,
    node_type: record.nodeType,
    status: record.status,
    started_at_ms: record.startedAt ?? null,
    ended_at_ms: record.endedAt ?? null,
    active_ms: Math.max(0, Math.round(record.activeMs)),
    attempt: record.attempt,
    skip_reason: record.skip?.reason ?? null,
    failure_code: record.failure?.code ?? null,
    input: record.input ?? null,
    output: record.output ?? null,
    record: {
      ...(record.skip?.via !== undefined && { via: record.skip.via }),
      ...(record.failure !== undefined && { failure: record.failure }),
      decisions: record.decisions,
      waits: record.waits,
      attempts: record.attempts,
      ...(record.counts !== undefined && { counts: record.counts }),
      meta: record.meta,
    },
  };
}

const SKIP_REASONS = new Set(['when', 'else', 'upstream', 'error']);
const STATUSES = new Set(['running', 'waiting', 'ok', 'skipped', 'failed']);

function arrayOf<T>(value: unknown): T[] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- rows are written by nodeRunRowOf only
  return Array.isArray(value) ? (value as T[]) : [];
}

/** A row read back as the record it was written from. Rows written by this
 * module only; a field that does not read is left out rather than guessed. */
export function nodeRunFromRow(row: NodeRunRow): NodeRunRecord {
  const rest = isRecord(row.record) ? row.record : {};
  const skipReason =
    row.skip_reason !== null && SKIP_REASONS.has(row.skip_reason)
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the membership test
        (row.skip_reason as NonNullable<NodeRunRecord['skip']>['reason'])
      : undefined;
  return {
    key: { path: row.path, item: row.item_index, pass: row.pass },
    nodeId: row.node_id,
    nodeType: row.node_type,
    status: STATUSES.has(row.status) ? row.status : 'failed',
    ...(row.started_at_ms !== null && { startedAt: row.started_at_ms }),
    ...(row.ended_at_ms !== null && { endedAt: row.ended_at_ms }),
    activeMs: row.active_ms,
    attempt: row.attempt,
    attempts: arrayOf(rest.attempts),
    ...(skipReason !== undefined && {
      skip: {
        reason: skipReason,
        ...(Array.isArray(rest.via) && { via: arrayOf<string>(rest.via) }),
      },
    }),
    ...(isRecord(rest.failure) && {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by nodeRunRowOf from a StepFailure
      failure: rest.failure as unknown as NonNullable<NodeRunRecord['failure']>,
    }),
    ...(row.input !== null && { input: row.input }),
    ...(row.output !== null && { output: row.output }),
    decisions: arrayOf(rest.decisions),
    waits: arrayOf(rest.waits),
    ...(isRecord(rest.counts) && {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by nodeRunRowOf from the record's counts
      counts: rest.counts as unknown as NonNullable<NodeRunRecord['counts']>,
    }),
    meta: isRecord(rest.meta) ? rest.meta : {},
  };
}

/** The run's input as its `__start` row: written when the run is born, so
 * every run's record begins with what it was given. */
export function startNodeRun(input: unknown, at: number): NodeRunWrite {
  const recorder = createRecorder({ now: () => at, budget: recordBudget() });
  const key = { path: START_PATH, item: -1, pass: -1 };
  recorder.unitStarted(key, { nodeId: START_PATH, nodeType: 'input' });
  recorder.unitFinished(key, { status: 'ok', output: input });
  const [row] = recorder.drain();
  if (row === undefined) throw new Error('the run input was not recorded');
  return row;
}

/** The bytes of stored values a batch of rows newly spent. */
export function nodeRunBytes(
  rows: readonly NodeRunWrite[] | undefined,
): number {
  let bytes = 0;
  for (const row of rows ?? []) bytes += Math.max(0, row.bytes);
  return bytes;
}

/**
 * Write `rows` whole, inside a transaction whose fenced run update already
 * matched. A row an older walker wrote is replaced; a row a newer walker
 * wrote is kept.
 */
export async function writeNodeRunsInTx(
  tx: TransactionSql,
  args: {
    organizationId: string;
    runId: string;
    epoch: number;
    rows: readonly NodeRunWrite[];
  },
): Promise<void> {
  if (args.rows.length === 0) return;
  await upsertRows(tx, args, false);
}

/**
 * A long step started: write its rows on their own, fenced by the run row
 * itself (the walker still holds a live run), so a live view shows it working
 * before its first commit. Answers whether they were written.
 */
export async function recordNodeRunsStarted(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    epoch: number;
    rows: readonly NodeRunWrite[];
  },
): Promise<{ written: boolean }> {
  if (args.rows.length === 0) return { written: false };
  return sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    const written = await upsertRows(tx, args, true);
    if (written) {
      const bytes = nodeRunBytes(args.rows);
      if (bytes > 0) {
        await tx`
          UPDATE app.automation_runs SET record_bytes = record_bytes + ${bytes}
          WHERE id = ${args.runId} AND org_id = ${args.organizationId}
            AND claim_epoch = ${args.epoch}
        `;
      }
      await emitRunHint(tx, args.organizationId, args.runId);
    }
    return { written };
  });
}

async function upsertRows(
  tx: TransactionSql,
  args: {
    organizationId: string;
    runId: string;
    epoch: number;
    rows: readonly NodeRunWrite[];
  },
  fenced: boolean,
): Promise<boolean> {
  const now = Date.now();
  const rows = jsonParam(
    tx,
    args.rows.map((row) => nodeRunRowOf(row.record)),
  );
  const written = await tx<{ path: string }[]>`
    INSERT INTO app.automation_node_runs AS s (
      run_id, org_id, path, item_index, pass, node_id, node_type, status,
      started_at_ms, ended_at_ms, active_ms, attempt, skip_reason,
      failure_code, input, output, record, claim_epoch, updated_at_ms)
    SELECT ${args.runId}, ${args.organizationId}, r.path, r.item_index,
           r.pass, r.node_id, r.node_type, r.status, r.started_at_ms,
           r.ended_at_ms, r.active_ms, r.attempt, r.skip_reason,
           r.failure_code, r.input, r.output,
           coalesce(r.record, '{}'::jsonb), ${args.epoch}::int, ${now}::bigint
    FROM jsonb_to_recordset(${rows}::jsonb) AS r(
      path text, item_index int, pass int, node_id text, node_type text,
      status text, started_at_ms bigint, ended_at_ms bigint, active_ms int,
      attempt int, skip_reason text, failure_code text, input jsonb,
      output jsonb, record jsonb)
    WHERE NOT ${fenced}::boolean OR EXISTS (
      SELECT 1 FROM app.automation_runs
      WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        AND claim_epoch = ${args.epoch}
        AND status IN ('queued', 'running', 'waiting'))
    ON CONFLICT (run_id, path, item_index, pass) DO UPDATE SET
      node_type = EXCLUDED.node_type, status = EXCLUDED.status,
      started_at_ms = EXCLUDED.started_at_ms,
      ended_at_ms = EXCLUDED.ended_at_ms, active_ms = EXCLUDED.active_ms,
      attempt = EXCLUDED.attempt, skip_reason = EXCLUDED.skip_reason,
      failure_code = EXCLUDED.failure_code, input = EXCLUDED.input,
      output = EXCLUDED.output, record = EXCLUDED.record,
      claim_epoch = EXCLUDED.claim_epoch,
      updated_at_ms = EXCLUDED.updated_at_ms
    WHERE s.claim_epoch <= EXCLUDED.claim_epoch
    RETURNING s.path
  `;
  return written.length > 0;
}

/** The rows an earlier turn of the run left running or waiting: what the
 * next turn's recorder resumes from. */
export async function readOpenNodeRuns(
  sql: Sql | TransactionSql,
  organizationId: string,
  runId: string,
): Promise<NodeRunRecord[]> {
  const rows = await sql<NodeRunRow[]>`
    SELECT path, item_index, pass, node_id, node_type, status,
           started_at_ms::float8 AS started_at_ms,
           ended_at_ms::float8 AS ended_at_ms, active_ms, attempt,
           skip_reason, failure_code, input, output, record
    FROM app.automation_node_runs
    WHERE run_id = ${runId} AND org_id = ${organizationId}
      AND status IN ('running', 'waiting')
    ORDER BY updated_at_ms DESC
    LIMIT ${OPEN_ROWS_READ}
  `;
  return rows.map(nodeRunFromRow);
}
