/** Real Postgres proof of the one order an organization's audit chain and a
 * trigger row are locked in (`trigger-failures.ts`, the module note): a run
 * landing through `finishRun` (its audit row, then the trigger's failure
 * streak) and an event producer stamping the same trigger through
 * `emitEvent` never deadlock, whichever of its two steps the producer takes
 * first — audit then emit (a task or a contact created) or emit then audit
 * (a comment edit, a conversation opened before its first message).
 *
 * Each case holds the producer between its two steps until the landing run
 * waits on it, then lets it go on: both must commit, the dispatch's stamp
 * must land (a deadlock raised inside `emitEvent`'s savepoint is swallowed
 * and would take it) and the streak must count the run (a deadlock raised
 * inside the streak's savepoint would skip it). The automation is saved and
 * never deployed, so the dispatch stamps `not_deployed` — a write of the
 * trigger row like a fire stamp — and no run of its own lands afterwards to
 * move the streak under the check. */
import type { Sql, TransactionSql } from 'postgres';

import { toJson } from '../../db/sql.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { emitEvent } from '../events/emit.ts';
import { deleteTrigger, finishRun, saveVersion, setTrigger } from './store.ts';

interface TriggerState {
  id: string;
  consecutiveFailures: number;
  lastFailedRunId: string | null;
  lastSkippedAt: number | null;
  lastSkipReason: string | null;
}

/** How long a case waits for the landing run to queue behind the producer. */
const BLOCK_WAIT_MS = 10_000;

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

export async function checkTriggerStreakLockOrder(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const name = 'itest/streak-lock-order';
  const event = 'comment.mentioned';

  await saveVersion(sql, {
    organizationId: orgId,
    name,
    document: {
      version: 1,
      name,
      nodes: [{ id: 'noop', type: 'transform', code: 'return null;' }],
      output: '{{ nodes.noop.output }}',
    },
    actor: userId,
  });
  await setTrigger(sql, {
    organizationId: orgId,
    name,
    trigger: { kind: 'event', event },
    actor: userId,
  });

  const trigger = async (): Promise<TriggerState> => {
    const rows = await sql<TriggerState[]>`
      SELECT id, consecutive_failures AS "consecutiveFailures",
             last_failed_run_id AS "lastFailedRunId",
             last_skipped_at_ms::float8 AS "lastSkippedAt",
             last_skip_reason AS "lastSkipReason"
      FROM app.automation_triggers
      WHERE org_id = ${orgId} AND name = ${name}
    `;
    const row = rows[0];
    if (row === undefined) throw new Error(`no trigger bound for ${name}`);
    return row;
  };
  /** A run of the trigger mid-flight, as the stepper holds it before it
   * lands: no step job and no wake stamp, so nothing but this check lands
   * it. */
  const runningRun = async (triggerId: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.automation_runs (
        org_id, name, version, project_id, status, mode, started_by,
        input, checkpoints, claim_epoch, started_at_ms
      ) VALUES (
        ${orgId}, ${name}, 1, NULL, 'running', 'live',
        ${`trigger:${triggerId}`},
        ${sql.json(toJson(JSON.stringify({ trigger: 'event', event })))},
        ${sql.json(toJson({ nodes: {}, executions: 1 }))}, 1, ${Date.now()}
      )
      RETURNING id
    `;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('itest run insert failed');
    return id;
  };

  try {
    for (const order of ['audit first', 'emit first'] as const) {
      const before = await trigger();
      const runId = await runningRun(before.id);
      const audit = (tx: TransactionSql) =>
        createAuditLog(tx, {
          organizationId: orgId,
          actorId: userId,
          actorType: 'user',
          action: 'itest.trigger_lock_order',
          category: 'data',
          resourceType: 'itest',
          resourceId: runId,
          status: 'success',
        });
      const emit = (tx: TransactionSql) =>
        emitEvent(tx, {
          organizationId: orgId,
          eventType: event,
          eventData: { itest: order },
        });
      const [first, second] =
        order === 'audit first' ? [audit, emit] : [emit, audit];

      let producerPid = 0;
      let halfway!: () => void;
      const reachedHalfway = new Promise<void>((resolve) => {
        halfway = resolve;
      });
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const startedAt = Date.now();
      const producer = sql.begin(async (tx) => {
        const pid = await tx<{ pid: number }[]>`
          SELECT pg_backend_pid() AS pid
        `;
        producerPid = pid[0]?.pid ?? 0;
        await first(tx);
        halfway();
        await released;
        await second(tx);
      });
      await Promise.race([reachedHalfway, producer]);
      const landing = finishRun(sql, {
        organizationId: orgId,
        runId,
        epoch: 1,
        status: 'failed',
        trace: [],
        effects: [],
        detail: `itest: lands beside an event producer (${order})`,
        failureCode: 'node_error',
        executions: 1,
      });
      // The landing run queues behind the producer's first step — the
      // chain it holds (audit first) or the chain and the trigger row its
      // dispatch holds (emit first) — before the producer takes its second.
      const queued = await waitFor(async () => {
        const waiting = await sql<{ pid: number }[]>`
          SELECT pid FROM pg_stat_activity
          WHERE ${producerPid}::int = ANY(pg_blocking_pids(pid))
        `;
        return waiting.length > 0;
      }, BLOCK_WAIT_MS);
      release();
      const [produced, landed] = await Promise.allSettled([producer, landing]);
      const after = await trigger();
      const status = await sql<{ status: string }[]>`
        SELECT status FROM app.automation_runs
        WHERE org_id = ${orgId} AND id = ${runId}
      `;
      const failure = (outcome: PromiseSettledResult<unknown>): string =>
        outcome.status === 'fulfilled'
          ? 'committed'
          : outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
      record(
        `a run landing beside an event producer that emits ${order === 'audit first' ? 'after' : 'before'} it audits: both commit, the stamp lands and the streak counts`,
        queued &&
          produced.status === 'fulfilled' &&
          landed.status === 'fulfilled' &&
          status[0]?.status === 'failed' &&
          after.lastSkipReason === 'not_deployed' &&
          after.lastSkippedAt !== null &&
          after.lastSkippedAt >= startedAt &&
          after.consecutiveFailures === before.consecutiveFailures + 1 &&
          after.lastFailedRunId === runId,
        `landing queued behind the producer=${queued}, producer ${failure(produced)}, landing ${failure(landed)} (run ${status[0]?.status ?? 'missing'}), dispatch stamp=${after.lastSkipReason}${after.lastSkippedAt !== null && after.lastSkippedAt >= startedAt ? ' (this case)' : ' (stale)'}, streak ${before.consecutiveFailures}→${after.consecutiveFailures} (want +1), last failed run=${after.lastFailedRunId === runId ? 'this run' : after.lastFailedRunId}`,
      );
    }
  } finally {
    await deleteTrigger(sql, orgId, name);
  }
}
