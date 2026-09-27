import type { TransactionSql } from 'postgres';

import { parseRunStarter } from '../../../lib/shared/run-starter.ts';
import {
  isPermanentFailureCode,
  PERMANENT_FAILURES_BEFORE_PAUSE,
} from '../../core/automations/failure.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { notifyTriggerPaused } from '../collab/service.ts';

/**
 * A trigger's failure streak (migration 0124), kept by `finishRun` in the
 * transaction that lands a run the trigger started (`trigger:<id>`):
 *
 * - a success sets the streak back to 0;
 * - a failure whose code the next occurrence would repeat
 *   (`isPermanentFailureCode`) adds one and becomes the trigger's last
 *   failure;
 * - anything else — a transient code, no code — neither counts nor breaks
 *   the streak (a cancel never reaches `finishRun`).
 *
 * Only runs started since the trigger was last saved count: saving starts a
 * fresh streak (`setTrigger` resets it), so a run still in flight from
 * before the save cannot re-pause a schedule someone just turned back on.
 *
 * When a SCHEDULE's streak reaches {@link PERMANENT_FAILURES_BEFORE_PAUSE}
 * while it is enabled, the same transaction pauses it — `enabled = false`
 * with the `paused_after_failures` skip reason — writes the audit row and
 * notifies the organization's owners and admins. Webhook and event triggers
 * keep their streak but are never paused: their runs carry a sender's
 * delivery or a platform event, which a paused trigger would drop, while a
 * schedule's occurrence carries nothing a later run cannot redo.
 *
 * The bookkeeping rides a savepoint, like an event dispatch (`emitEvent`):
 * the run's own terminal write is the contract, and a fault here must never
 * leave the run unfinished for the liveness sweep to re-poke forever — it is
 * logged and the streak misses that run. The notice rides one more, so a
 * failed bell never takes the pause and its audit row with it.
 */

/** The fields of the landing run the streak reads. */
export interface TriggerRunOutcome {
  organizationId: string;
  runId: string;
  /** `automation_runs.started_by` — only `trigger:<id>` is kept here. */
  startedBy: string;
  startedAt: number;
  status: 'success' | 'failed';
  failureCode: string | null;
  now: number;
}

/** What changed on the trigger's read, for the caller's definition hint. */
type StreakChange = { name: string; paused: boolean } | null;

interface CountedTrigger {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  consecutiveFailures: number;
}

/**
 * Keep the streak of the trigger that started a landing run. Answers the
 * automation whose trigger read changed — the caller emits its definition
 * hint so an open Trigger section refreshes — or null when nothing did.
 */
export async function recordTriggerRunOutcome(
  tx: TransactionSql,
  outcome: TriggerRunOutcome,
): Promise<StreakChange> {
  const starter = parseRunStarter(outcome.startedBy);
  if (starter.kind !== 'trigger') return null;
  const success = outcome.status === 'success';
  if (!success && !isPermanentFailureCode(outcome.failureCode)) return null;
  try {
    return await tx.savepoint((sp) =>
      success
        ? resetStreak(sp, starter.triggerId, outcome)
        : countFailure(sp, starter.triggerId, outcome),
    );
  } catch (error) {
    console.error(
      `[automations] run ${outcome.runId}: the failure streak of trigger ${starter.triggerId} was not kept`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function resetStreak(
  tx: TransactionSql,
  triggerId: string,
  outcome: TriggerRunOutcome,
): Promise<StreakChange> {
  const reset = await tx<{ name: string }[]>`
    UPDATE app.automation_triggers SET consecutive_failures = 0
    WHERE id = ${triggerId} AND org_id = ${outcome.organizationId}
      AND consecutive_failures > 0
      AND updated_at_ms <= ${outcome.startedAt}
    RETURNING name
  `;
  const row = reset[0];
  return row === undefined ? null : { name: row.name, paused: false };
}

async function countFailure(
  tx: TransactionSql,
  triggerId: string,
  outcome: TriggerRunOutcome,
): Promise<StreakChange> {
  // A save moves `updated_at_ms` past the last counted failure; the streak
  // before it is stale and this failure starts a new one. `setTrigger`
  // resets the counter itself — this also covers a save by an image that
  // predates the counter, mid-roll (0124).
  const counted = await tx<CountedTrigger[]>`
    UPDATE app.automation_triggers SET
      consecutive_failures = CASE
        WHEN last_failed_at_ms IS NULL OR last_failed_at_ms < updated_at_ms
          THEN 1
        ELSE consecutive_failures + 1
      END,
      last_failed_at_ms = ${outcome.now},
      last_failure_code = ${outcome.failureCode},
      last_failed_run_id = ${outcome.runId}
    WHERE id = ${triggerId} AND org_id = ${outcome.organizationId}
      AND updated_at_ms <= ${outcome.startedAt}
    RETURNING id, name, kind, enabled,
              consecutive_failures AS "consecutiveFailures"
  `;
  const trigger = counted[0];
  if (trigger === undefined) return null;
  if (
    trigger.kind !== 'schedule' ||
    !trigger.enabled ||
    trigger.consecutiveFailures < PERMANENT_FAILURES_BEFORE_PAUSE
  ) {
    return { name: trigger.name, paused: false };
  }
  // The row lock the count took holds until commit, so a concurrent
  // finish of the same trigger's run waits here and then reads it paused.
  await tx`
    UPDATE app.automation_triggers SET
      enabled = false,
      last_skipped_at_ms = ${outcome.now},
      last_skip_reason = 'paused_after_failures'
    WHERE id = ${trigger.id}
  `;
  // `failureCode` is non-null here: `isPermanentFailureCode` refused null.
  const code = outcome.failureCode ?? '';
  await createAuditLog(tx, {
    organizationId: outcome.organizationId,
    actorId: outcome.startedBy,
    actorType: 'system',
    action: 'automation.trigger.paused',
    category: 'ai',
    resourceType: 'automation_trigger',
    resourceId: trigger.id,
    resourceName: trigger.name,
    previousState: { enabled: true },
    newState: { enabled: false, lastSkipReason: 'paused_after_failures' },
    status: 'success',
    metadata: {
      consecutiveFailures: trigger.consecutiveFailures,
      pauseAfter: PERMANENT_FAILURES_BEFORE_PAUSE,
      lastFailureCode: code,
      lastFailedRunId: outcome.runId,
    },
  });
  try {
    await tx.savepoint((sp) =>
      notifyTriggerPaused(sp, {
        organizationId: outcome.organizationId,
        triggerId: trigger.id,
        name: trigger.name,
        failures: trigger.consecutiveFailures,
        code,
      }),
    );
  } catch (error) {
    console.error(
      `[automations] trigger ${outcome.organizationId}/${trigger.name}: the pause notice was not sent`,
      error instanceof Error ? error.message : error,
    );
  }
  console.warn(
    `[automations] trigger ${outcome.organizationId}/${trigger.name}: schedule paused after ${trigger.consecutiveFailures} consecutive failures (${code}, run ${outcome.runId})`,
  );
  return { name: trigger.name, paused: true };
}
