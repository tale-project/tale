import type { Sql, TransactionSql } from 'postgres';

import { truncateRunDetail } from '../../core/automations/bound_run_payload.ts';
import type {
  AttemptKind,
  BeginAttempt,
} from '../../core/automations/ledger.ts';
import { jsonParam } from '../../db/sql.ts';
import { instanceId } from '../../lib/instance.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { recordRunEventInTx } from './run-events.ts';
import { AutomationError, emitRunHint, pokeParkedRunInTx } from './store.ts';

/**
 * The effect ledger (`app.automation_node_attempts`, migration 0162): one row
 * per call a run makes outside itself — a connector write or a model call —
 * addressed by the node's path, its forEach item and its repeat pass.
 *
 * A walker begins an attempt BEFORE the call and finishes it after. The
 * begin is fenced by the walker's claim epoch, so a walker that lost its run
 * cannot start a call. On a resumed run the row decides what happens:
 *
 * - `done`: the call happened and its output is reused — never called again;
 * - `failed`: the recorded failure is replayed;
 * - `started` with nobody's decision: the call may or may not have happened.
 *   A re-callable call (a model call, an action that may safely be repeated)
 *   is made again; any other waits for a person (`in_doubt`);
 * - a person's decision: run it again, skip it (it returned nothing), or fail
 *   the run.
 */

// What a begin answers is the stepper's contract (`core/automations/ledger.ts`);
// this module is its store.
export type AttemptResolution = 'retry' | 'skip' | 'fail';

export interface BeginAttemptArgs {
  organizationId: string;
  runId: string;
  epoch: number;
  /** The node's path: its id at the top level, `<parent>[<item>:<pass>]/<id>`
   * inside a subautomation. */
  nodeId: string;
  itemIndex: number;
  pass: number;
  kind: AttemptKind;
  nodeType: string;
  /** The resolved input the call is made with. */
  input: unknown;
  /** Whether the call may be made again when an earlier attempt's outcome is
   * unknown — a model call, or an action declared safe to repeat. */
  recallable: boolean;
}

/** A write the run waits on a person about. */
export interface InDoubtAttempt {
  attemptId: string;
  nodeId: string;
  itemIndex: number;
  pass: number;
  attempt: number;
  kind: AttemptKind;
  nodeType: string;
  input: unknown;
  startedAt: number;
}

interface AttemptRow {
  id: string;
  attempt: number;
  status: 'started' | 'done' | 'failed';
  output: unknown;
  error: string | null;
  failureCode: string | null;
  resolution: AttemptResolution | null;
  resolvedBy: string | null;
}

/**
 * Begin a call, or learn what an earlier attempt of the same call left. One
 * transaction: the run row is share-locked at the walker's epoch first, so a
 * claim that supersedes this walker either waits for the begin or makes it
 * read `stale` — a stale walker inserts nothing.
 */
export async function beginNodeAttempt(
  sql: Sql,
  args: BeginAttemptArgs,
): Promise<BeginAttempt> {
  return sql.begin(async (tx): Promise<BeginAttempt> => {
    const now = Date.now();
    const fence = await tx<{ id: string }[]>`
      SELECT id FROM app.automation_runs
      WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        AND claim_epoch = ${args.epoch} AND status = 'running'
      FOR SHARE
    `;
    if (!fence[0]) return { kind: 'stale' };
    const input = jsonParam(tx, args.input);
    const inserted = await tx<{ attempt: number }[]>`
      INSERT INTO app.automation_node_attempts (
        run_id, org_id, node_id, item_index, pass, attempt, kind, node_type,
        status, input, lease_owner, claim_epoch, started_at_ms
      ) VALUES (
        ${args.runId}, ${args.organizationId}, ${args.nodeId},
        ${args.itemIndex}, ${args.pass}, 1, ${args.kind}, ${args.nodeType},
        'started', ${input}, ${instanceId()}, ${args.epoch}, ${now}
      )
      ON CONFLICT (run_id, node_id, item_index, pass) DO NOTHING
      RETURNING attempt
    `;
    if (inserted[0]) return { kind: 'go', attempt: inserted[0].attempt };

    const rows = await tx<AttemptRow[]>`
      SELECT id, attempt, status, output, error,
             failure_code AS "failureCode", resolution,
             resolved_by AS "resolvedBy"
      FROM app.automation_node_attempts
      WHERE run_id = ${args.runId} AND org_id = ${args.organizationId}
        AND node_id = ${args.nodeId} AND item_index = ${args.itemIndex}
        AND pass = ${args.pass}
      FOR UPDATE
    `;
    const row = rows[0];
    // The insert met a row this read cannot see: nothing to act on safely.
    if (!row) return { kind: 'stale' };
    if (row.status === 'done') return { kind: 'done', output: row.output };
    if (row.status === 'failed') {
      return {
        kind: 'failed',
        error: row.error ?? 'the step failed',
        failureCode: row.failureCode,
      };
    }
    if (row.resolution === 'skip') {
      await tx`
        UPDATE app.automation_node_attempts SET
          status = 'done', output = NULL, finished_at_ms = ${now}
        WHERE id = ${row.id}
      `;
      return { kind: 'skip' };
    }
    if (row.resolution === 'fail') {
      return { kind: 'fail', resolvedBy: row.resolvedBy ?? 'unknown' };
    }
    if (row.resolution === 'retry' || args.recallable) {
      const again = await tx<{ attempt: number }[]>`
        UPDATE app.automation_node_attempts SET
          attempt = attempt + 1, resolution = NULL, input = ${input},
          lease_owner = ${instanceId()}, claim_epoch = ${args.epoch},
          started_at_ms = ${now}
        WHERE id = ${row.id}
        RETURNING attempt
      `;
      return { kind: 'go', attempt: again[0]?.attempt ?? row.attempt + 1 };
    }
    return { kind: 'in_doubt', attemptId: row.id, attempt: row.attempt };
  });
}

/**
 * Record how a call ended. Not fenced by the claim epoch: what really
 * happened is worth recording whoever holds the run now. Only the attempt
 * that was begun, and only while it is still `started`; answers whether it
 * was.
 */
export async function finishNodeAttempt(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    nodeId: string;
    itemIndex: number;
    pass: number;
    attempt: number;
    status: 'done' | 'failed';
    output?: unknown;
    error?: string;
    failureCode?: string | null;
  },
): Promise<{ recorded: boolean }> {
  const output = args.status === 'done' ? jsonParam(sql, args.output) : null;
  const rows = await sql<{ id: string }[]>`
    UPDATE app.automation_node_attempts SET
      status = ${args.status}, output = ${output},
      error = ${args.error === undefined ? null : truncateRunDetail(args.error)},
      failure_code = ${args.failureCode ?? null},
      finished_at_ms = ${Date.now()}
    WHERE run_id = ${args.runId} AND org_id = ${args.organizationId}
      AND node_id = ${args.nodeId} AND item_index = ${args.itemIndex}
      AND pass = ${args.pass} AND attempt = ${args.attempt}
      AND status = 'started'
    RETURNING id
  `;
  return { recorded: rows.length > 0 };
}

/**
 * The write a run waits on a person about: the latest connector attempt left
 * `started` with no decision, while the run is parked on it. Null when the
 * run waits on nothing of the kind.
 */
export async function readOpenInDoubt(
  sql: Sql | TransactionSql,
  organizationId: string,
  runId: string,
): Promise<InDoubtAttempt | null> {
  const rows = await sql<InDoubtAttempt[]>`
    SELECT a.id AS "attemptId", a.node_id AS "nodeId",
           a.item_index AS "itemIndex", a.pass, a.attempt, a.kind,
           a.node_type AS "nodeType", a.input,
           a.started_at_ms::float8 AS "startedAt"
    FROM app.automation_node_attempts a
    JOIN app.automation_runs r ON r.id = a.run_id AND r.org_id = a.org_id
    WHERE a.run_id = ${runId} AND a.org_id = ${organizationId}
      AND a.status = 'started' AND a.resolution IS NULL
      AND a.kind = 'connector'
      AND r.status = 'waiting' AND r.detail LIKE 'in_doubt:%'
    ORDER BY a.started_at_ms DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * A person's decision about a write that may already have happened: recorded
 * on the attempt, in the run's history and (for a live run) the audit log,
 * and the parked run woken in the same transaction. Locks the run row first,
 * then the attempt, then the audit chain — the order the terminal doors take
 * — so a decision racing a stop or a finish queues instead of deadlocking.
 */
export async function resolveInDoubtInTx(
  tx: TransactionSql,
  args: {
    organizationId: string;
    runId: string;
    attemptId: string;
    resolution: AttemptResolution;
    /** The user who decided. */
    actor: string;
  },
): Promise<void> {
  const runs = await tx<
    {
      status: string;
      detail: string | null;
      mode: string;
      name: string;
      version: number;
    }[]
  >`
    SELECT status, detail, mode, name, version FROM app.automation_runs
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
    FOR UPDATE
  `;
  const run = runs[0];
  if (
    !run ||
    run.status !== 'waiting' ||
    run.detail?.startsWith('in_doubt:') !== true
  ) {
    throw new AutomationError(
      'RUN_NOT_IN_DOUBT',
      'The run is not waiting for a decision about a step that may already have run.',
      409,
    );
  }
  const resolved = await tx<
    { nodeId: string; itemIndex: number; pass: number }[]
  >`
    UPDATE app.automation_node_attempts SET
      resolution = ${args.resolution}, resolved_by = ${args.actor},
      resolved_at_ms = ${Date.now()}
    WHERE id = ${args.attemptId} AND run_id = ${args.runId}
      AND org_id = ${args.organizationId}
      AND status = 'started' AND resolution IS NULL
    RETURNING node_id AS "nodeId", item_index AS "itemIndex", pass
  `;
  const attempt = resolved[0];
  if (!attempt) {
    throw new AutomationError(
      'IN_DOUBT_ALREADY_RESOLVED',
      'This step was already decided, or it no longer waits for a decision.',
      409,
    );
  }
  const where = {
    nodeId: attempt.nodeId,
    itemIndex: attempt.itemIndex,
    pass: attempt.pass,
  };
  await recordRunEventInTx(tx, {
    organizationId: args.organizationId,
    runId: args.runId,
    kind: 'in_doubt_resolved',
    detail: {
      attemptId: args.attemptId,
      ...where,
      resolution: args.resolution,
    },
  });
  if (run.mode === 'live') {
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actor,
      actorType: 'user',
      action: 'automation.run.in_doubt_resolved',
      category: 'ai',
      resourceType: 'automation_run',
      resourceId: args.runId,
      resourceName: `${run.name}@${run.version}`,
      status: 'success',
      metadata: { ...where, resolution: args.resolution },
    });
  }
  await pokeParkedRunInTx(tx, {
    organizationId: args.organizationId,
    runId: args.runId,
  });
  await emitRunHint(tx, args.organizationId, args.runId);
}
