import type { Sql, TransactionSql } from 'postgres';

import { isStandingProjectAgentSession } from '../../core/sandbox/session_naming.ts';
import {
  lockProjectWork,
  queueOnProjectWork,
} from '../../lib/project-work-lock.ts';
import { recordTaskAgentRunLedgerEntry } from './run-ledger.ts';

/**
 * Slot releases that wake a project's standing role (#4540, migration 0168).
 *
 * A project agent's run that ends frees one of its standing workers. Until
 * now nothing recorded that: the manager that hands out work entered only on
 * its schedule's next cron minute. Here the release is recorded on the
 * project's wake row (`app.project_wakes`) IN the transaction whose terminal
 * election won — no savepoint, so the release and its signal commit together
 * or not at all. The schedule scan fires the opted-in schedule early for a
 * pending row (`automations/wakes.ts`); only a manager turn that captured the
 * release at admission and then launched and settled covers it.
 *
 * Lock discipline: every write to the wake row holds the project's work key
 * (`lib/project-work-lock.ts`), the one a task write takes before the project
 * row — after the run and task rows, in a terminal election as in a task
 * write. Nobody therefore ever waits on a wake row. A serialization failure
 * raised by the wake statement is marked with that key alone, and the marks
 * the callers add (the completion's `task-comment:<taskId>`) prepend to it.
 */

/** The first backoff step of a wake whose occurrence did not serve. */
const WAKE_BACKOFF_BASE_MS = 60_000;
/** The backoff's cap: in steady state one wake fire an hour per project. */
export const WAKE_BACKOFF_CAP_MS = 60 * 60_000;

/**
 * How long a wake waits after its `attempts`-th consecutive non-serving end:
 * `min(60 s · 2^(n−1), 60 min)` — 1, 2, 4, 8, 16, 32, then 60 minutes for
 * good. Never exhausted: a transient fault recovers the same generation by
 * itself once it clears, with no new release and no cron minute.
 */
export function wakeBackoffMs(attempts: number): number {
  if (attempts === Infinity) return WAKE_BACKOFF_CAP_MS;
  const n = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
  // 2^6 · 60 s already passes the cap; stop before the power grows.
  if (n > 7) return WAKE_BACKOFF_CAP_MS;
  return Math.min(WAKE_BACKOFF_BASE_MS * 2 ** (n - 1), WAKE_BACKOFF_CAP_MS);
}

/** How a self run — the wake target's own admitted manager turn — ended. */
type SelfRunEnd =
  | { status: 'settled'; launched: boolean }
  | { status: 'cancelled' }
  | { status: 'failed'; retryArmed: boolean };

/** What a self run's end writes on the wake row. */
type SelfRunWakeWrite =
  | { kind: 'consume' }
  | { kind: 'non_serving'; outcome: 'manager_cancelled' | 'manager_failed' }
  | { kind: 'none' };

/**
 * Consume only on a proved serving pass: a turn that launched and settled.
 * A cancel — queued or running — and a failure for good keep the generation
 * pending and count one non-serving attempt; a failure whose automatic retry
 * is armed writes nothing, because the retry is the same occurrence's turn.
 */
export function selfRunWakeWrite(end: SelfRunEnd): SelfRunWakeWrite {
  if (end.status === 'settled') {
    return end.launched
      ? { kind: 'consume' }
      : { kind: 'non_serving', outcome: 'manager_failed' };
  }
  if (end.status === 'cancelled') {
    return { kind: 'non_serving', outcome: 'manager_cancelled' };
  }
  return end.retryArmed
    ? { kind: 'none' }
    : { kind: 'non_serving', outcome: 'manager_failed' };
}

/**
 * Whether a worker's release signals (root's Q4): only a run that worked in
 * one of its agent's standing workers, that is not a failure whose automatic
 * retry is still armed (that slot is not free), and after which no other run
 * of the agent is live in that workspace.
 */
export function releaseSignals(release: {
  inStandingWorkspace: boolean;
  retryArmed: boolean;
  workspaceBusy: boolean;
}): boolean {
  return (
    release.inStandingWorkspace && !release.retryArmed && !release.workspaceBusy
  );
}

interface ReleasedRun {
  organizationId: string;
  projectId: string;
  taskId: string;
  agentId: string;
  sessionId: string;
  status: string;
  launched: boolean;
  startedVia: string | null;
  startedViaRunId: string | null;
  retryArmed: boolean;
}

const TERMINAL_STATUSES = new Set(['settled', 'failed', 'cancelled']);

/** The opted-in schedule bound to the project — the wake target T. At most
 * one is enabled (the save refuses a second); a disabled one still receives
 * the signal, and the scan mirrors its state instead of firing it. */
async function wakeTargetOf(
  tx: TransactionSql,
  run: { organizationId: string; projectId: string },
): Promise<string | null> {
  const rows = await tx<{ id: string }[]>`
    SELECT t.id FROM app.automation_triggers t
    JOIN app.automation_project_bindings b
      ON b.org_id = t.org_id AND b.automation_name = t.name
    WHERE t.org_id = ${run.organizationId}
      AND b.project_id = ${run.projectId}
      AND t.kind = 'schedule' AND t.wake_on_slot_freed
    ORDER BY t.enabled DESC, t.updated_at_ms DESC, t.id
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

/** Whether T's own occurrence started the run: its automation run answers
 * to `trigger:<T>`. Such a run never raises the signal — the role can never
 * start itself recursively. */
async function startedByTarget(
  tx: TransactionSql,
  run: ReleasedRun,
  triggerId: string,
): Promise<boolean> {
  if (run.startedVia !== 'automation' || run.startedViaRunId === null) {
    return false;
  }
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM app.automation_runs
    WHERE id = ${run.startedViaRunId} AND org_id = ${run.organizationId}
      AND started_by = ${`trigger:${triggerId}`}
    LIMIT 1
  `;
  return rows.length > 0;
}

/** Run a wake-row statement under the project's work key; a serialization
 * failure is marked with that key (callers' outer marks prepend to it). */
async function underProjectWork<T>(
  tx: TransactionSql,
  projectId: string,
  write: () => Promise<T>,
): Promise<T> {
  await lockProjectWork(tx, projectId);
  try {
    return await write();
  } catch (error) {
    throw queueOnProjectWork(error, projectId);
  }
}

/** The self run's write (D6). `captured` is the generation the occurrence's
 * slot-receipt run captured at admission; NULL (a manager started before the
 * opt-in, or by a person) consumes nothing. */
async function recordSelfRunEnd(
  tx: TransactionSql,
  run: ReleasedRun,
  now: number,
): Promise<void> {
  const write = selfRunWakeWrite(
    run.status === 'settled'
      ? { status: 'settled', launched: run.launched }
      : run.status === 'cancelled'
        ? { status: 'cancelled' }
        : { status: 'failed', retryArmed: run.retryArmed },
  );
  if (write.kind === 'none') return;
  await underProjectWork(tx, run.projectId, async () => {
    const rows = await tx<{ attempts: number }[]>`
      SELECT attempts FROM app.project_wakes
      WHERE org_id = ${run.organizationId} AND project_id = ${run.projectId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (row === undefined) return;
    if (write.kind === 'consume') {
      const receipts = await tx<{ captured: number | null }[]>`
        SELECT wake_admitted_seq::float8 AS captured
        FROM app.project_agent_runs
        WHERE org_id = ${run.organizationId}
          AND started_via_run_id = ${run.startedViaRunId}
          AND trigger = 'automation'
        ORDER BY started_at_ms, id
        LIMIT 1
      `;
      const captured = receipts[0]?.captured ?? null;
      await tx`
        UPDATE app.project_wakes AS w SET
          consumed_seq = GREATEST(w.consumed_seq,
            LEAST(w.signal_seq, coalesce(${captured}::bigint, w.consumed_seq))),
          attempts = 0, not_before_ms = NULL,
          outcome = 'served', outcome_at_ms = ${now},
          blocked_reason = NULL,
          manager_task_id = ${run.taskId}, manager_agent_id = ${run.agentId},
          pending_since_ms = CASE
            WHEN w.signal_seq > GREATEST(w.consumed_seq,
              LEAST(w.signal_seq, coalesce(${captured}::bigint, w.consumed_seq)))
            THEN ${now}::bigint ELSE NULL END,
          updated_at_ms = ${now}
        WHERE w.org_id = ${run.organizationId}
          AND w.project_id = ${run.projectId}
      `;
      return;
    }
    const attempts = row.attempts + 1;
    await tx`
      UPDATE app.project_wakes SET
        attempts = ${attempts},
        not_before_ms = ${now + wakeBackoffMs(attempts)},
        outcome = ${write.outcome}, outcome_at_ms = ${now},
        manager_task_id = ${run.taskId}, manager_agent_id = ${run.agentId},
        updated_at_ms = ${now}
      WHERE org_id = ${run.organizationId} AND project_id = ${run.projectId}
    `;
  });
}

/**
 * Record one run's release on its project's wake row — inside the
 * transaction whose terminal election (or retirement) just won, after the
 * run row is terminal. A no-op when the project has no wake target.
 *
 * Errors propagate: the release and its signal commit together or not at all
 * (a fault here aborts the run's end as a ledger fault would; whatever ends
 * the run later runs this again).
 */
export async function recordSlotReleaseInTx(
  tx: TransactionSql,
  args: { runId: string; organizationId: string },
): Promise<void> {
  const now = Date.now();
  const runs = await tx<ReleasedRun[]>`
    SELECT org_id AS "organizationId", project_id AS "projectId",
           task_id AS "taskId", agent_id AS "agentId",
           session_id AS "sessionId", status,
           launched_at_ms IS NOT NULL AS launched,
           started_via AS "startedVia",
           started_via_run_id AS "startedViaRunId",
           (status = 'failed' AND auto_retry_armed_at_ms IS NOT NULL
             AND auto_retry_refused_at_ms IS NULL) AS "retryArmed"
    FROM app.project_agent_runs
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
  `;
  const run = runs[0];
  if (run === undefined || !TERMINAL_STATUSES.has(run.status)) return;
  const triggerId = await wakeTargetOf(tx, run);
  if (triggerId === null) return;
  if (await startedByTarget(tx, run, triggerId)) {
    await recordSelfRunEnd(tx, run, now);
    return;
  }
  // Another run on the manager's own card — a person's, say — is self too:
  // it carries no capture, so it covers nothing, and it never signals.
  const managers = await tx<{ managerTaskId: string | null }[]>`
    SELECT manager_task_id AS "managerTaskId" FROM app.project_wakes
    WHERE org_id = ${run.organizationId} AND project_id = ${run.projectId}
  `;
  if (managers[0]?.managerTaskId === run.taskId) return;
  const inStandingWorkspace = isStandingProjectAgentSession(
    run.agentId,
    run.sessionId,
  );
  // Match claimAgentWorker's occupancy: a queued, unclaimed or parked run
  // only names worker 1 provisionally and holds no worker.
  const busy = inStandingWorkspace
    ? await tx<{ id: string }[]>`
        SELECT id FROM app.project_agent_runs
        WHERE org_id = ${run.organizationId}
          AND session_id = ${run.sessionId} AND agent_id = ${run.agentId}
          AND (status = 'running'
            OR (status = 'queued' AND waiting_for_capacity_at_ms IS NULL
              AND session_claimed_at_ms IS NOT NULL))
        LIMIT 1
      `
    : [];
  if (
    !releaseSignals({
      inStandingWorkspace,
      retryArmed: run.retryArmed,
      workspaceBusy: busy.length > 0,
    })
  ) {
    return;
  }
  await underProjectWork(tx, run.projectId, async () => {
    await tx`
      INSERT INTO app.project_wakes AS w (
        org_id, project_id, trigger_id, signal_seq, pending_since_ms,
        signaled_at_ms, updated_at_ms
      ) VALUES (
        ${run.organizationId}, ${run.projectId}, ${triggerId}, 1, ${now},
        ${now}, ${now}
      )
      ON CONFLICT (org_id, project_id) DO UPDATE SET
        signal_seq = w.signal_seq + 1,
        signaled_at_ms = ${now},
        pending_since_ms = CASE WHEN w.signal_seq = w.consumed_seq
          THEN ${now}::bigint ELSE w.pending_since_ms END,
        trigger_id = ${triggerId},
        updated_at_ms = ${now}
    `;
  });
}

/**
 * A run's terminal provenance and its release, together: the ledger entry
 * first (it takes the chain key and the head row), then the release, which
 * re-enters the key. Every terminal election calls this instead of the
 * ledger alone, so no path that ends a run can forget its release.
 */
export async function recordRunTerminalInTx(
  tx: TransactionSql,
  entry: Parameters<typeof recordTaskAgentRunLedgerEntry>[1],
): Promise<void> {
  await recordTaskAgentRunLedgerEntry(tx, entry);
  await recordSlotReleaseInTx(tx, {
    runId: entry.runId,
    organizationId: entry.organizationId,
  });
}

/**
 * The generation an admission captures (D5): when the starting automation
 * run answers to `trigger:<T>` and T is the wake target of the task's
 * project, the wake row's `signal_seq` as this transaction's snapshot sees
 * it — a plain read, no lock and no write. `undefined` for every other
 * start.
 */
export async function wakeGenerationForStart(
  sql: Sql | TransactionSql,
  args: { organizationId: string; taskId: string; startedBy: string },
): Promise<number | undefined> {
  if (!args.startedBy.startsWith('trigger:')) return undefined;
  const rows = await sql<{ signalSeq: number }[]>`
    SELECT w.signal_seq::float8 AS "signalSeq"
    FROM app.tasks k
    JOIN app.project_wakes w
      ON w.org_id = k.org_id AND w.project_id = k.project_id
    WHERE k.id = ${args.taskId} AND k.org_id = ${args.organizationId}
      AND ${args.startedBy} = 'trigger:' || w.trigger_id
    LIMIT 1
  `;
  return rows[0]?.signalSeq;
}
