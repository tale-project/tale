import type { Sql, TransactionSql } from 'postgres';

import { scheduleTriggerInput } from '../../../lib/engine/core/slots.ts';
import { tryLockAuditChain } from '../audit_logs/service.ts';
import { failedRunRetryPending } from '../tasks/agent-runs.ts';
import {
  automatedStartWindow,
  inPlaceStartRefusal,
} from '../tasks/delegated-start.ts';
import { openTaskBlockerIds } from '../tasks/dependencies.ts';
import { wakeBackoffMs } from '../tasks/slot-wakes.ts';
import { AutomationError, beginRunInTx } from './store.ts';
import { stampFired } from './triggers.ts';

/**
 * The wake fire (#4540, migration 0168): after the schedule walk, the
 * `automation.trigger_scan` job fires the opted-in schedule T of every
 * project with a pending release (`tasks/slot-wakes.ts`) early — as one more
 * ordinary occurrence of T, under T's own authority (`trigger:<T>`), with the
 * schedule input of the current minute. It is never a second manager, never
 * a self-start and never a shorter cron: the occurrence starts its manager
 * through the ordinary admission (circuit and `retryAfter`), then claims or
 * waits for its own worker through the existing task turn job.
 *
 * Per pending row, in ONE transaction: the org's chain key (try-lock — a busy
 * organization is skipped for the minute, so the scan never stalls behind
 * one), then the wake row `FOR UPDATE SKIP LOCKED`, then — in order — the
 * previous occurrence's classification, the target's state, a live T
 * occurrence, the wait, the derived holds, and the fire. Every wait names
 * what makes the wake eligible again (`WakeOutcome`).
 */

const MINUTE_MS = 60_000;
/** Pending rows one scan visits; the rest are visited by the next ones,
 * least recently visited first. */
export const WAKE_SCAN_LIMIT = 200;
/** An automation run in these statuses still holds its occurrence. */
const LIVE_AUTOMATION_RUN_STATUSES = [
  'queued',
  'running',
  'waiting',
  'quarantined',
];

type WakeOutcome =
  | 'fired'
  | 'admitted'
  | 'served'
  | 'not_admitted'
  | 'manager_cancelled'
  | 'manager_failed'
  | 'paused'
  | 'held'
  | 'held_card'
  | 'target_disabled'
  | 'blocked';

interface WakeRow {
  organizationId: string;
  projectId: string;
  triggerId: string;
  signalSeq: number;
  consumedSeq: number;
  firedRunId: string | null;
  attempts: number;
  notBefore: number | null;
  outcome: WakeOutcome | null;
  blockedReason: string | null;
  managerTaskId: string | null;
  managerAgentId: string | null;
}

interface TargetRow {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  wakeOnSlotFreed: boolean;
  bound: boolean;
  lastSkipReason: string | null;
  lastFailureCode: string | null;
  lastRunId: string | null;
  updatedAt: number;
}

/** The target's state as the wake mirrors it — `null` while T may fire. */
export function targetBlock(
  target: Pick<
    TargetRow,
    'kind' | 'enabled' | 'wakeOnSlotFreed' | 'bound' | 'lastSkipReason'
  > & { lastFailureCode: string | null },
): { outcome: 'blocked' | 'target_disabled'; reason: string | null } | null {
  if (
    target.kind === 'schedule' &&
    target.enabled &&
    target.wakeOnSlotFreed &&
    target.bound
  ) {
    return null;
  }
  // AUTO-R13's pause is an explicit operator state: only a person with the
  // owner, admin or developer role clears it, by saving the trigger
  // natively (`POST /:name/trigger`); a managed apply is refused while it
  // stands. The wake keeps its generation and names the cause.
  if (!target.enabled && target.lastSkipReason === 'paused_after_failures') {
    return {
      outcome: 'blocked',
      reason: `paused_after_failures:${target.lastFailureCode ?? 'unknown'}`,
    };
  }
  return { outcome: 'target_disabled', reason: null };
}

/** How the previous wake occurrence ended, once its automation run is over:
 * `admitted` when its start step left a slot-receipt run, otherwise not
 * admitted — a refusal, a throw, a cancel or a success that never reached
 * the start — which counts one attempt toward the backoff. */
export function classifyOccurrence(args: {
  receipt: { taskId: string; agentId: string } | null;
  attempts: number;
  endedAt: number;
}):
  | { outcome: 'admitted'; managerTaskId: string; managerAgentId: string }
  | { outcome: 'not_admitted'; attempts: number; notBefore: number } {
  if (args.receipt !== null) {
    return {
      outcome: 'admitted',
      managerTaskId: args.receipt.taskId,
      managerAgentId: args.receipt.agentId,
    };
  }
  const attempts = args.attempts + 1;
  return {
    outcome: 'not_admitted',
    attempts,
    notBefore: args.endedAt + wakeBackoffMs(attempts),
  };
}

interface WakeScanResult {
  examined: number;
  fired: number;
  waiting: number;
  /** Rows skipped for the minute: the org's chain key or the row was busy. */
  busy: number;
  failed: number;
}

async function readTarget(
  tx: TransactionSql,
  row: WakeRow,
): Promise<TargetRow | null> {
  const rows = await tx<TargetRow[]>`
    SELECT t.id, t.name, t.kind, t.enabled,
           t.wake_on_slot_freed AS "wakeOnSlotFreed",
           EXISTS (
             SELECT 1 FROM app.automation_project_bindings b
             WHERE b.org_id = t.org_id AND b.automation_name = t.name
               AND b.project_id = ${row.projectId}
           ) AS bound,
           t.last_skip_reason AS "lastSkipReason",
           t.last_failure_code AS "lastFailureCode",
           t.last_run_id AS "lastRunId",
           t.updated_at_ms::float8 AS "updatedAt"
    FROM app.automation_triggers t
    WHERE t.id = ${row.triggerId} AND t.org_id = ${row.organizationId}
  `;
  return rows[0] ?? null;
}

/** The slot-receipt run of an automation run's start step. */
async function slotReceipt(
  tx: TransactionSql,
  organizationId: string,
  automationRunId: string,
): Promise<{ taskId: string; agentId: string } | null> {
  const rows = await tx<{ taskId: string; agentId: string }[]>`
    SELECT task_id AS "taskId", agent_id AS "agentId"
    FROM app.project_agent_runs
    WHERE org_id = ${organizationId}
      AND started_via_run_id = ${automationRunId}
      AND trigger = 'automation'
    ORDER BY started_at_ms, id
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function writeOutcome(
  tx: TransactionSql,
  row: WakeRow,
  now: number,
  set: {
    outcome: WakeOutcome;
    attempts?: number;
    notBefore?: number | null;
    blockedReason?: string | null;
    managerTaskId?: string;
    managerAgentId?: string;
  },
): Promise<void> {
  await tx`
    UPDATE app.project_wakes SET
      outcome = ${set.outcome}, outcome_at_ms = ${now},
      attempts = ${set.attempts ?? row.attempts},
      not_before_ms = ${set.notBefore === undefined ? row.notBefore : set.notBefore}::bigint,
      blocked_reason = ${set.blockedReason === undefined ? row.blockedReason : set.blockedReason},
      manager_task_id = ${set.managerTaskId ?? row.managerTaskId},
      manager_agent_id = ${set.managerAgentId ?? row.managerAgentId},
      updated_at_ms = ${now}
    WHERE org_id = ${row.organizationId} AND project_id = ${row.projectId}
  `;
}

type RowResult = 'fired' | 'waiting' | 'busy';

/** One pending row, in the caller's transaction (see the module note). */
async function fireProjectWake(
  tx: TransactionSql,
  key: { organizationId: string; projectId: string },
  now: number,
): Promise<RowResult> {
  if (!(await tryLockAuditChain(tx, key.organizationId))) return 'busy';
  const rows = await tx<WakeRow[]>`
    SELECT org_id AS "organizationId", project_id AS "projectId",
           trigger_id AS "triggerId",
           signal_seq::float8 AS "signalSeq",
           consumed_seq::float8 AS "consumedSeq",
           fired_run_id AS "firedRunId", attempts,
           not_before_ms::float8 AS "notBefore", outcome,
           blocked_reason AS "blockedReason",
           manager_task_id AS "managerTaskId",
           manager_agent_id AS "managerAgentId"
    FROM app.project_wakes
    WHERE org_id = ${key.organizationId} AND project_id = ${key.projectId}
      AND signal_seq > consumed_seq
    FOR UPDATE SKIP LOCKED
  `;
  let row = rows[0];
  if (row === undefined) return 'busy';

  // 1. Classify the previous wake occurrence once its run is over.
  if (row.outcome === 'fired' && row.firedRunId !== null) {
    const occurrences = await tx<{ live: boolean; endedAt: number | null }[]>`
      SELECT status = ANY(${LIVE_AUTOMATION_RUN_STATUSES}) AS live,
             finished_at_ms::float8 AS "endedAt"
      FROM app.automation_runs
      WHERE id = ${row.firedRunId} AND org_id = ${row.organizationId}
    `;
    const occurrence = occurrences[0];
    if (occurrence === undefined || !occurrence.live) {
      const receipt = await slotReceipt(tx, row.organizationId, row.firedRunId);
      const classified = classifyOccurrence({
        receipt,
        attempts: row.attempts,
        endedAt: occurrence?.endedAt ?? now,
      });
      if (classified.outcome === 'admitted') {
        await writeOutcome(tx, row, now, {
          outcome: 'admitted',
          managerTaskId: classified.managerTaskId,
          managerAgentId: classified.managerAgentId,
        });
        row = {
          ...row,
          outcome: 'admitted',
          managerTaskId: classified.managerTaskId,
          managerAgentId: classified.managerAgentId,
        };
      } else {
        await writeOutcome(tx, row, now, {
          outcome: 'not_admitted',
          attempts: classified.attempts,
          notBefore: classified.notBefore,
        });
        row = {
          ...row,
          outcome: 'not_admitted',
          attempts: classified.attempts,
          notBefore: classified.notBefore,
        };
      }
    }
  }

  // 2. The target: enabled, opted in, bound in the same org — else mirror.
  const target = await readTarget(tx, row);
  const block =
    target === null
      ? { outcome: 'target_disabled' as const, reason: null }
      : targetBlock(target);
  if (block !== null) {
    if (row.outcome !== block.outcome || row.blockedReason !== block.reason) {
      await writeOutcome(tx, row, now, {
        outcome: block.outcome,
        blockedReason: block.reason,
      });
    }
    return 'waiting';
  }
  if (target === null) return 'waiting';
  // A save cleared the explicit state: the same generation is eligible now.
  if (row.outcome === 'blocked' || row.outcome === 'target_disabled') {
    row = { ...row, attempts: 0, notBefore: null, blockedReason: null };
  }

  // 3. No live occurrence of T — a cron one or a wake one.
  if (target.lastRunId !== null) {
    const live = await tx<{ id: string }[]>`
      SELECT id FROM app.automation_runs
      WHERE id = ${target.lastRunId} AND org_id = ${row.organizationId}
        AND status = ANY(${LIVE_AUTOMATION_RUN_STATUSES})
    `;
    if (live.length > 0) return 'waiting';
  }

  // 4. The wait: the circuit's exact retryAfter, or the backoff.
  if (row.notBefore !== null && row.notBefore > now) return 'waiting';

  // 5. Derived holds, once the manager is known.
  let managerTaskId = row.managerTaskId;
  let managerAgentId = row.managerAgentId;
  if ((managerTaskId === null || managerAgentId === null) && target.lastRunId) {
    const receipt = await slotReceipt(tx, row.organizationId, target.lastRunId);
    managerTaskId = receipt?.taskId ?? null;
    managerAgentId = receipt?.agentId ?? null;
  }
  if (managerTaskId !== null && managerAgentId !== null) {
    const held = await managerHold(tx, {
      organizationId: row.organizationId,
      taskId: managerTaskId,
      agentId: managerAgentId,
    });
    if (held !== null) {
      if (held.outcome === 'paused') {
        await writeOutcome(tx, row, now, {
          outcome: 'paused',
          notBefore: held.retryAfter,
        });
      } else if (row.outcome !== held.outcome) {
        await writeOutcome(tx, row, now, { outcome: held.outcome });
      }
      return 'waiting';
    }
  }

  // 6. Fire: claim the minute on T (the scan's own conditional claim, after
  // the chain key — the house order), start one occurrence, stamp it.
  const minute = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  const claimed = await tx<{ id: string }[]>`
    UPDATE app.automation_triggers SET last_due_at_ms = ${minute}
    WHERE id = ${target.id}
      AND kind = 'schedule' AND enabled = true AND wake_on_slot_freed
      AND updated_at_ms = ${target.updatedAt}
      AND (GREATEST(last_due_at_ms, last_fired_at_ms) IS NULL
           OR GREATEST(last_due_at_ms, last_fired_at_ms) < ${minute})
    RETURNING id
  `;
  if (claimed.length === 0) return 'waiting';
  let started: { runId: string; version: number } | null;
  try {
    started = await beginRunInTx(tx, {
      organizationId: row.organizationId,
      name: target.name,
      input: scheduleTriggerInput(minute),
      mode: 'live',
      startedBy: `trigger:${target.id}`,
    });
  } catch (error) {
    if (!(error instanceof AutomationError)) throw error;
    started = null;
  }
  if (started === null) {
    // Refused or nothing deployed: not admitted, with the capped backoff.
    const attempts = row.attempts + 1;
    await writeOutcome(tx, row, now, {
      outcome: 'not_admitted',
      attempts,
      notBefore: now + wakeBackoffMs(attempts),
      blockedReason: null,
    });
    return 'waiting';
  }
  await stampFired(tx, target.id, minute, started.runId);
  await tx`
    UPDATE app.project_wakes SET
      fired_seq = signal_seq, fired_run_id = ${started.runId},
      attempts = ${row.attempts}, not_before_ms = NULL, blocked_reason = NULL,
      outcome = 'fired', outcome_at_ms = ${now}, updated_at_ms = ${now}
    WHERE org_id = ${row.organizationId} AND project_id = ${row.projectId}
  `;
  return 'fired';
}

/** Why the manager cannot take this wake now, or `null` when it can. */
async function managerHold(
  tx: TransactionSql,
  manager: { organizationId: string; taskId: string; agentId: string },
): Promise<
  | { outcome: 'held' | 'held_card' }
  | { outcome: 'paused'; retryAfter: number }
  | null
> {
  const tasks = await tx<
    {
      id: string;
      status: string;
      assigneeType: string | null;
      assigneeId: string | null;
    }[]
  >`
    SELECT id, status, assignee_type AS "assigneeType",
           assignee_id AS "assigneeId"
    FROM app.tasks
    WHERE id = ${manager.taskId} AND org_id = ${manager.organizationId}
  `;
  const task = tasks[0];
  if (task === undefined) return { outcome: 'held_card' };
  // The occurrence starts the card's assignee: a card handed to another
  // agent, a person or nobody would put someone else to work, so the wake
  // waits until the manager holds its card again (W14).
  if (task.assigneeType !== 'agent' || task.assigneeId !== manager.agentId) {
    return { outcome: 'held_card' };
  }
  // The manager card is still at work, or will be: its own live run or
  // armed retry. Another task of the same agent uses another worker and
  // does not hold this wake; ordinary worker admission owns capacity.
  const live = await tx<{ id: string; status: string }[]>`
    SELECT id, status FROM app.project_agent_runs
    WHERE org_id = ${manager.organizationId} AND task_id = ${manager.taskId}
    ORDER BY seq DESC
    LIMIT 1
  `;
  const newest = live[0];
  if (newest !== undefined) {
    if (newest.status === 'queued' || newest.status === 'running') {
      return { outcome: 'held' };
    }
    if (
      newest.status === 'failed' &&
      (await failedRunRetryPending(tx, manager.taskId, newest.id))
    ) {
      return { outcome: 'held' };
    }
  }
  // The card the start would refuse: re-read every scan, so nothing spins.
  if (
    (await inPlaceStartRefusal(tx, {
      organizationId: manager.organizationId,
      task,
    })) !== null ||
    (await openTaskBlockerIds(tx, task.id)).length > 0
  ) {
    return { outcome: 'held_card' };
  }
  // The circuit: wait for its exact retryAfter, with no refusal row.
  const window = await automatedStartWindow(tx, {
    id: task.id,
    organizationId: manager.organizationId,
  });
  if (!window.admitted) {
    return { outcome: 'paused', retryAfter: window.retryAfter };
  }
  return null;
}

/**
 * Fire every due wake — run by `automation.trigger_scan` after the schedule
 * walk. Bounded per scan; a row's failure is logged and leaves the row as it
 * was (its transaction rolls back), and never stops the others.
 */
export async function fireDueProjectWakes(
  sql: Sql,
  options: { limit?: number } = {},
): Promise<WakeScanResult> {
  const now = Date.now();
  const result: WakeScanResult = {
    examined: 0,
    fired: 0,
    waiting: 0,
    busy: 0,
    failed: 0,
  };
  // The fair visit — the recovery sweeps' clock (`tasks/reattach.ts`,
  // migration 0150): claim the pending rows visited longest ago, never
  // visited first, and stamp them BEFORE working them. A row that stays
  // ineligible (blocked, held, waiting, busy, failing) moves to the back, so
  // it can never hold a slot ahead of a later project every minute. Bounded
  // per scan; the stamp is a visit, never a fire, a consume or an outcome.
  // Two overlapping scans may visit a row twice; its own transaction (the
  // chain key, `SKIP LOCKED`, the minute claim) makes that harmless.
  const pending = await sql<{ organizationId: string; projectId: string }[]>`
    WITH candidates AS (
      SELECT w.org_id, w.project_id
      FROM app.project_wakes w
      LEFT JOIN app.project_wake_visits v
        ON v.org_id = w.org_id AND v.project_id = w.project_id
      WHERE w.signal_seq > w.consumed_seq
      ORDER BY v.visited_at_ms ASC NULLS FIRST, w.pending_since_ms NULLS FIRST,
               w.org_id, w.project_id
      LIMIT ${options.limit ?? WAKE_SCAN_LIMIT}
    )
    INSERT INTO app.project_wake_visits AS v (org_id, project_id, visited_at_ms)
    SELECT org_id, project_id, ${now} FROM candidates
    ON CONFLICT (org_id, project_id)
      DO UPDATE SET visited_at_ms = EXCLUDED.visited_at_ms
    RETURNING v.org_id AS "organizationId", v.project_id AS "projectId"
  `;
  for (const key of pending) {
    result.examined++;
    try {
      const outcome = await sql.begin((tx) => fireProjectWake(tx, key, now));
      result[outcome]++;
    } catch (error) {
      result.failed++;
      console.error(
        `[wakes] wake of ${key.organizationId}/${key.projectId} failed:`,
        error,
      );
    }
  }
  return result;
}
