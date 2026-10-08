import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { toJson } from '../../db/sql.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { emitEvent } from '../events/emit.ts';
import { sweepOrgPhase2 } from '../retention/service.ts';
import {
  deleteRunInTx,
  deleteTrigger,
  finishRun,
  getRun,
  saveVersion,
  setTrigger,
} from './store.ts';
/** Real Postgres proof of the one order an organization's audit chain and a
 * trigger row are locked in (`trigger-failures.ts`, the module note): a run
 * landing through `finishRun` (its audit row, then the trigger's failure
 * streak) never deadlocks beside another transaction that writes the same
 * trigger row and audits —
 *
 * - an event producer stamping the trigger through `emitEvent`, whichever of
 *   its two steps it takes first: audit then emit (a task or a contact
 *   created) or emit then audit (a comment edit, a conversation opened
 *   before its first message);
 * - a removal of the run the trigger names as its last failure, through the
 *   run door (`deleteRunInTx`, in the REST door's serializable transaction
 *   after its run read) or by the retention sweep: the delete clears that
 *   name (the foreign key's `ON DELETE SET NULL`), a write of the trigger
 *   row, before the removal's audit row.
 *
 * Each case holds the other transaction between its two steps until the
 * landing run waits on it, then lets it go on: both must commit — the run
 * door on its first attempt, since a retry would hide a deadlock it lost —
 * the other transaction's own write must land (a deadlock raised inside
 * `emitEvent`'s savepoint is swallowed and would take the dispatch's stamp)
 * and the streak must count the run (a deadlock raised inside the streak's
 * savepoint would skip it). The automation is saved and never deployed, so
 * a dispatch stamps `not_deployed` — a write of the trigger row like a fire
 * stamp — and no run of its own lands afterwards to move the streak under
 * the check.
 *
 * The chain is held no wider than that order needs: a sweep whose batch no
 * trigger names, held after its delete, lets an audit writer of the same
 * organization commit meanwhile. */
import { markAutomationWriterInTx } from './writer-protocol.ts';

interface TriggerState {
  id: string;
  consecutiveFailures: number;
  lastFailedRunId: string | null;
  lastSkippedAt: number | null;
  lastSkipReason: string | null;
}

/** How long a case waits for the landing run to queue behind the other
 * transaction. */
const BLOCK_WAIT_MS = 10_000;

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** A gate one transaction waits at until the case lets it go on. */
function gate(): {
  reached: Promise<void>;
  reach: () => void;
  released: Promise<void>;
  release: () => void;
} {
  let reach!: () => void;
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reached, reach, released, release };
}

/** The transaction, held at its first statement after it deleted a run —
 * after the trigger row that delete's foreign key cleared, before the audit
 * row that follows — until the gate opens. */
function heldAfterRunDelete(
  tx: TransactionSql,
  at: ReturnType<typeof gate>,
): TransactionSql {
  let deleted = false;
  let held = false;
  return new Proxy(tx, {
    apply(target, thisArg, argArray: unknown[]) {
      if (deleted && !held) {
        held = true;
        at.reach();
        return at.released.then(() => Reflect.apply(target, thisArg, argArray));
      }
      const strings = argArray[0];
      if (
        Array.isArray(strings) &&
        strings.join('').includes('DELETE FROM app.automation_runs')
      ) {
        deleted = true;
      }
      return Reflect.apply(target, thisArg, argArray);
    },
  });
}

const failure = (outcome: PromiseSettledResult<unknown>): string =>
  outcome.status === 'fulfilled'
    ? 'committed'
    : outcome.reason instanceof Error
      ? outcome.reason.message
      : String(outcome.reason);

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
  const bind = (organizationId: string) =>
    setTrigger(sql, {
      organizationId,
      name,
      trigger: { kind: 'event', event },
      actor: userId,
    });
  await bind(orgId);

  const trigger = async (organizationId = orgId): Promise<TriggerState> => {
    const rows = await sql<TriggerState[]>`
      SELECT id, consecutive_failures AS "consecutiveFailures",
             last_failed_run_id AS "lastFailedRunId",
             last_skipped_at_ms::float8 AS "lastSkippedAt",
             last_skip_reason AS "lastSkipReason"
      FROM app.automation_triggers
      WHERE org_id = ${organizationId} AND name = ${name}
    `;
    const row = rows[0];
    if (row === undefined) throw new Error(`no trigger bound for ${name}`);
    return row;
  };
  /** A run of the trigger mid-flight, as the stepper holds it before it
   * lands: no step job and no wake stamp, so nothing but this check lands
   * it. */
  const runningRun = async (
    triggerId: string,
    organizationId = orgId,
  ): Promise<string> => {
    const rows = await sql.begin(async (fixtureTx) => {
      await markAutomationWriterInTx(fixtureTx);
      return fixtureTx<{ id: string }[]>`
      INSERT INTO app.automation_runs (
        org_id, name, version, project_id, status, mode, started_by,
        input, checkpoints, claim_epoch, started_at_ms
      ) VALUES (
        ${organizationId}, ${name}, 1, NULL, 'running', 'live',
        ${`trigger:${triggerId}`},
        ${sql.json(toJson(JSON.stringify({ trigger: 'event', event })))},
        ${sql.json(toJson({ nodes: {}, executions: 1 }))}, 1, ${Date.now()}
      )
      RETURNING id
    `;
    });
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('itest run insert failed');
    return id;
  };
  const land = (runId: string, detail: string, organizationId = orgId) =>
    finishRun(sql, {
      organizationId,
      runId,
      epoch: 1,
      status: 'failed',
      trace: [],
      effects: [],
      detail,
      failureCode: 'node_error',
      executions: 1,
    });
  const runStatus = async (
    runId: string,
    organizationId = orgId,
  ): Promise<string> => {
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM app.automation_runs
      WHERE org_id = ${organizationId} AND id = ${runId}
    `;
    return rows[0]?.status ?? 'missing';
  };
  /** Whether a session waits on the backend `pid` holds. */
  const blockedBy = (pid: () => number) =>
    waitFor(async () => {
      const waiting = await sql<{ pid: number }[]>`
        SELECT pid FROM pg_stat_activity
        WHERE ${pid()}::int = ANY(pg_blocking_pids(pid))
      `;
      return waiting.length > 0;
    }, BLOCK_WAIT_MS);

  /** `sql` whose every transaction is handed to `hold` first: the sweep
   * opens its own transactions, and the one that deletes the runs is held
   * like the run door's. */
  const holding = (
    hold: (tx: TransactionSql) => Promise<TransactionSql>,
  ): Sql =>
    new Proxy(sql, {
      get(target, property, receiver) {
        if (property !== 'begin') {
          return Reflect.get(target, property, receiver);
        }
        return (body: (tx: TransactionSql) => Promise<unknown>) =>
          target.begin(async (tx) => body(await hold(tx)));
      },
    });
  const sweep = (
    organizationId: string,
    hold: (tx: TransactionSql) => Promise<TransactionSql>,
  ): Promise<number> =>
    sweepOrgPhase2(
      holding(hold),
      {
        organizationId,
        config: { workflowLogEnabled: true, workflowLogRetentionDays: 30 },
      },
      { orgHeld: false, userMembershipIds: new Set() },
    ).then((stats) => stats.automationRuns);

  // A second organization for the removal cases: the sweep removes every
  // finished run of its organization older than the window, and the run
  // door's serializable transaction must commit on its first attempt, which
  // another lane's audit writer in the same organization could cost it — so
  // they run where nothing but this lane's runs and audit rows live.
  const removalOrgId = randomUUID();
  await sql`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${removalOrgId}, 'Streak lock order (removals)',
            ${`itest-streak-lock-${removalOrgId.slice(0, 8)}`}, now())
  `;

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
      const halfway = gate();
      const startedAt = Date.now();
      const producer = sql.begin(async (tx) => {
        const pid = await tx<{ pid: number }[]>`
          SELECT pg_backend_pid() AS pid
        `;
        producerPid = pid[0]?.pid ?? 0;
        await first(tx);
        halfway.reach();
        await halfway.released;
        await second(tx);
      });
      await Promise.race([halfway.reached, producer]);
      const landing = land(
        runId,
        `itest: lands beside an event producer (${order})`,
      );
      // The landing run queues behind the producer's first step — the
      // chain it holds (audit first) or the chain and the trigger row its
      // dispatch holds (emit first) — before the producer takes its second.
      const queued = await blockedBy(() => producerPid);
      halfway.release();
      const [produced, landed] = await Promise.allSettled([producer, landing]);
      const after = await trigger();
      const status = await runStatus(runId);
      record(
        `a run landing beside an event producer that emits ${order === 'audit first' ? 'after' : 'before'} it audits: both commit, the stamp lands and the streak counts`,
        queued &&
          produced.status === 'fulfilled' &&
          landed.status === 'fulfilled' &&
          status === 'failed' &&
          after.lastSkipReason === 'not_deployed' &&
          after.lastSkippedAt !== null &&
          after.lastSkippedAt >= startedAt &&
          after.consecutiveFailures === before.consecutiveFailures + 1 &&
          after.lastFailedRunId === runId,
        `landing queued behind the producer=${queued}, producer ${failure(produced)}, landing ${failure(landed)} (run ${status}), dispatch stamp=${after.lastSkipReason}${after.lastSkippedAt !== null && after.lastSkippedAt >= startedAt ? ' (this case)' : ' (stale)'}, streak ${before.consecutiveFailures}→${after.consecutiveFailures} (want +1), last failed run=${after.lastFailedRunId === runId ? 'this run' : after.lastFailedRunId}`,
      );
    }

    await bind(removalOrgId);
    const organizationId = removalOrgId;
    for (const remover of ['run door', 'retention sweep'] as const) {
      const bound = await trigger(organizationId);
      // The run the removal takes: a failure the trigger names as its last.
      const removedRunId = await runningRun(bound.id, organizationId);
      await land(
        removedRunId,
        'itest: the run a removal takes',
        organizationId,
      );
      if (remover === 'retention sweep') {
        const longAgo = Date.now() - 400 * DAY_MS;
        await sql.begin(async (fixtureTx) => {
          await markAutomationWriterInTx(fixtureTx);
          return fixtureTx`
          UPDATE app.automation_runs
          SET started_at_ms = ${longAgo}, finished_at_ms = ${longAgo}
          WHERE id = ${removedRunId}
        `;
        });
      }
      const before = await trigger(organizationId);
      const runId = await runningRun(bound.id, organizationId);

      let removerPid = 0;
      let attempts = 0;
      const halfway = gate();
      const held = async (tx: TransactionSql) => {
        const pid = await tx<{ pid: number }[]>`
          SELECT pg_backend_pid() AS pid
        `;
        removerPid = pid[0]?.pid ?? 0;
        return heldAfterRunDelete(tx, halfway);
      };
      const removal: Promise<number> =
        remover === 'run door'
          ? // The REST door's transaction (`DELETE …/runs/{runId}`):
            // serializable, the run read, then the removal. A retry would
            // mean the door lost a deadlock or its snapshot, which
            // `transactSerializable` hides from the caller — so the case
            // counts the attempts.
            transactSerializable(sql, async (tx) => {
              attempts++;
              const door = await held(tx);
              const run = await getRun(door, organizationId, removedRunId);
              if (run === null || run.projectId !== null) return 0;
              const removed = await deleteRunInTx(door, {
                organizationId,
                runId: removedRunId,
                actor: userId,
              });
              return removed.deleted ? 1 : 0;
            })
          : sweep(organizationId, held);
      await Promise.race([halfway.reached, removal]);
      const landing = land(
        runId,
        `itest: lands beside a removal (${remover})`,
        organizationId,
      );
      // The landing run queues behind the removal, on the chain the removal
      // took before its delete. Without that, the landing run would take the
      // chain first and wait on the trigger row the delete cleared, while
      // the removal waited on the chain for its audit row.
      const queued = await blockedBy(() => removerPid);
      halfway.release();
      const [removed, landed] = await Promise.allSettled([removal, landing]);
      const after = await trigger(organizationId);
      const status = await runStatus(runId, organizationId);
      const gone = await runStatus(removedRunId, organizationId);
      record(
        `a run landing while the ${remover} removes the trigger's last failed run: both commit, the run goes and the streak counts`,
        queued &&
          removed.status === 'fulfilled' &&
          removed.value === 1 &&
          (remover !== 'run door' || attempts === 1) &&
          landed.status === 'fulfilled' &&
          status === 'failed' &&
          gone === 'missing' &&
          after.consecutiveFailures === before.consecutiveFailures + 1 &&
          after.lastFailedRunId === runId,
        `landing queued behind the removal=${queued}, removal ${failure(removed)}${removed.status === 'fulfilled' ? ` (${removed.value} run removed, want 1)` : ''}${remover === 'run door' ? `, door attempts=${attempts} (want 1)` : ''}, landing ${failure(landed)} (run ${status}), removed run ${gone} (want missing), streak ${before.consecutiveFailures}→${after.consecutiveFailures} (want +1), last failed run=${after.lastFailedRunId === runId ? 'this run' : after.lastFailedRunId}`,
      );
    }

    // A sweep whose batch no trigger names writes no trigger row, so it
    // takes the chain only for its own audit row: an audit writer of the
    // organization commits while the sweep sits after its delete, instead
    // of queueing behind a delete of up to a thousand runs.
    {
      const longAgo = Date.now() - 400 * DAY_MS;
      // A person's run: no trigger names it.
      const rows = await sql.begin(async (fixtureTx) => {
        await markAutomationWriterInTx(fixtureTx);
        return fixtureTx<{ id: string }[]>`
        INSERT INTO app.automation_runs (
          org_id, name, version, project_id, status, mode, started_by,
          input, checkpoints, claim_epoch, started_at_ms, finished_at_ms
        ) VALUES (
          ${removalOrgId}, ${name}, 1, NULL, 'success', 'live',
          ${`user:${userId}`}, ${sql.json(toJson(JSON.stringify({})))},
          ${sql.json(toJson({ nodes: {}, executions: 1 }))}, 1,
          ${longAgo}, ${longAgo}
        )
        RETURNING id
      `;
      });
      const unnamedRunId = rows[0]?.id;
      if (unnamedRunId === undefined) {
        throw new Error('itest run insert failed');
      }
      const halfway = gate();
      const swept = sweep(removalOrgId, async (tx) =>
        heldAfterRunDelete(tx, halfway),
      );
      await Promise.race([halfway.reached, swept]);
      const writer = sql.begin((tx) =>
        createAuditLog(tx, {
          organizationId: removalOrgId,
          actorId: userId,
          actorType: 'user',
          action: 'itest.trigger_lock_order',
          category: 'data',
          resourceType: 'itest',
          resourceId: unnamedRunId,
          status: 'success',
        }),
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wroteWhileHeld = await Promise.race([
        writer.then(
          () => true,
          () => false,
        ),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), BLOCK_WAIT_MS);
        }),
      ]);
      clearTimeout(timer);
      halfway.release();
      const [sweptOut, written] = await Promise.allSettled([swept, writer]);
      const gone = await runStatus(unnamedRunId, removalOrgId);
      record(
        'a retention sweep whose batch no trigger names holds no audit chain across its delete: an audit writer of the organization commits meanwhile',
        wroteWhileHeld &&
          sweptOut.status === 'fulfilled' &&
          sweptOut.value === 1 &&
          written.status === 'fulfilled' &&
          gone === 'missing',
        `audit writer committed while the sweep sat after its delete=${wroteWhileHeld} (want true), sweep ${failure(sweptOut)}${sweptOut.status === 'fulfilled' ? ` (${sweptOut.value} run removed, want 1)` : ''}, writer ${failure(written)}, removed run ${gone} (want missing)`,
      );
    }
  } finally {
    await deleteTrigger(sql, orgId, name);
    await deleteTrigger(sql, removalOrgId, name);
    await sql.begin(async (fixtureTx) => {
      await markAutomationWriterInTx(fixtureTx);
      return fixtureTx`
      DELETE FROM app.automation_runs WHERE org_id = ${removalOrgId}
    `;
    });
    await sql`DELETE FROM "organization" WHERE "id" = ${removalOrgId}`;
  }
}
