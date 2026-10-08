/** Exact b493 declarations; tests guard every body against the retained raw source.
 * Adapter only projects PG rows and omits realtime hints; it adds no fencing.
 * Historical fixture only; .dockerignore excludes services/platform/tests. */
import type { Sql } from 'postgres';

import { boundCheckpointTrace } from '../../../backend/core/automations/bound_run_payload.ts';
import type { NodeCheckpoint } from '../../../backend/core/automations/checkpoints.ts';
import { toJson } from '../../../backend/db/sql.ts';
import { runRow, emitRunHint } from './adapter.ts';
const RUN_CLAIM_PROMISE_MS = 180_000;

export async function claimRun(
  sql: Sql,
  organizationId: string,
  runId: string,
): Promise<{ claimed: boolean; status: string; epoch: number }> {
  return sql.begin(async (tx) => {
    const now = Date.now();
    // ATOMIC claim: the epoch bump reads and writes the SAME row under the
    // UPDATE's row lock, so two concurrent claims (a liveness re-poke racing
    // the live chain, a pg-boss retry) serialize and get DISTINCT epochs —
    // the later one wins and the earlier walker's writes read back 'stale' at
    // the epoch fence. The old read-then-write under READ COMMITTED was a
    // lost update: both read N, both wrote N+1, and both passed the fence,
    // double-stepping one run.
    const claimed = await tx<{ claimEpoch: number }[]>`
      UPDATE app.automation_runs SET
        status = 'running', claim_epoch = claim_epoch + 1, claimed_at_ms = ${now},
        wake_at_ms = ${now + RUN_CLAIM_PROMISE_MS}
      WHERE id = ${runId} AND org_id = ${organizationId}
        AND status IN ('queued', 'running', 'waiting')
      RETURNING claim_epoch AS "claimEpoch"
    `;
    if (claimed[0]) {
      await emitRunHint(tx, organizationId, runId);
      return { claimed: true, status: 'running', epoch: claimed[0].claimEpoch };
    }
    // Not claimable — report WHY (terminal vs missing) so the stepper's turn
    // exits with the same status it always did.
    const row = await runRow(tx, organizationId, runId);
    if (!row) return { claimed: false, status: 'missing', epoch: 0 };
    return { claimed: false, status: row.status, epoch: row.claimEpoch };
  });
}

interface CheckpointsShape {
  nodes: Record<string, unknown>;
  cursor?: unknown;
  executions: number;
}

function readCheckpoints(raw: unknown): CheckpointsShape {
  if (raw !== null && typeof raw === 'object' && 'nodes' in raw) {
    const record = raw as {
      nodes?: unknown;
      cursor?: unknown;
      executions?: unknown;
    };
    return {
      nodes:
        record.nodes !== null && typeof record.nodes === 'object'
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper owns this JSON shape
            (record.nodes as Record<string, unknown>)
          : {},
      ...(record.cursor !== undefined ? { cursor: record.cursor } : {}),
      executions: typeof record.executions === 'number' ? record.executions : 0,
    };
  }
  return { nodes: {}, executions: 0 };
}

function boundIncomingCheckpoint(checkpoint: unknown): unknown {
  if (
    checkpoint === null ||
    typeof checkpoint !== 'object' ||
    Array.isArray(checkpoint) ||
    !('trace' in checkpoint) ||
    checkpoint.trace === null ||
    typeof checkpoint.trace !== 'object'
  ) {
    return checkpoint;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper owns this JSON shape; narrowed above
  return boundCheckpointTrace(checkpoint as NodeCheckpoint);
}

export async function recordProgress(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    epoch: number;
    nodeId?: string;
    checkpoint?: unknown;
    cursor?: unknown;
    executions: number;
  },
): Promise<{ status: string }> {
  return sql.begin(async (tx) => {
    const row = await runRow(tx, args.organizationId, args.runId);
    if (!row) return { status: 'missing' };
    if (
      row.status === 'success' ||
      row.status === 'failed' ||
      row.status === 'cancelled'
    ) {
      return { status: row.status };
    }
    if (row.claimEpoch !== args.epoch) return { status: 'stale' };
    const checkpoints = readCheckpoints(row.checkpoints);
    const nodes =
      args.nodeId !== undefined && args.checkpoint !== undefined
        ? Object.assign({}, checkpoints.nodes, {
            [args.nodeId]: boundIncomingCheckpoint(args.checkpoint),
          })
        : checkpoints.nodes;
    await tx`
      UPDATE app.automation_runs SET
        checkpoints = ${tx.json(
          toJson({
            nodes,
            ...(args.cursor !== undefined && args.cursor !== null
              ? { cursor: args.cursor }
              : {}),
            executions: args.executions,
          }),
        )},
        wake_at_ms = ${Date.now() + RUN_CLAIM_PROMISE_MS}
      WHERE id = ${args.runId}
    `;
    await emitRunHint(tx, args.organizationId, args.runId);
    return { status: row.status };
  });
}
