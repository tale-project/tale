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
 * - a success sets the streak back to 0, except on a schedule its failures
 *   paused, which keeps it (below);
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
 * A paused schedule keeps the streak that paused it: a run still in flight
 * when the pause landed may succeed afterwards, and it must not leave a
 * paused schedule reading "0 runs in a row failed". Only a save clears it.
 * Paused means off AND stamped `paused_after_failures` — the test the
 * Trigger section's banner makes — never the stamp alone. The image before
 * 0124 re-enables a paused schedule without clearing the stamp (its bind
 * keeps the skip stamps of an unchanged kind), and nothing but a skip or a
 * later save overwrites it; a live schedule still carrying it must reset on
 * a success, or its permanent failures would add up across the successes
 * between them and pause it again for failures that were not in a row.
 *
 * Lock order — the organization's audit chain BEFORE any trigger row, in
 * every transaction that takes both:
 *
 * - `finishRun` writes the run's audit row first and keeps the streak after
 *   it; a pause audits again under the chain it already holds;
 * - an event dispatch (`dispatchAutomationEvent`, inside the producer's
 *   transaction) takes the chain (`lockAuditChain`) before it stamps a
 *   trigger, so a producer that emits before it audits (a comment edit's
 *   `comment.mentioned`, a conversation opened before its first message)
 *   holds the chain by then, like one that audited first (a task or a
 *   contact created);
 * - removing a run writes the row too: `last_run_id` and
 *   `last_failed_run_id` are `ON DELETE SET NULL`, so the delete clears the
 *   trigger that names the run. The run door (`deleteRunInTx`) and the
 *   retention sweep lock the runs' own rows, then the chain, then delete —
 *   the order a landing run takes its row, the chain and the trigger in.
 *   The sweep takes the chain there only when a trigger names a run of its
 *   batch: otherwise its delete writes no trigger row, and holding the chain
 *   across a delete of up to a thousand runs would queue every audit writer
 *   of the organization behind it. Erasure removes only runs a person or a
 *   key started, which no trigger names;
 * - the schedule scan, the webhook door and saving or removing a trigger
 *   write the row and take no chain in that transaction.
 *
 * A landing run and a producer stamping the same event trigger, or a
 * removal of the run the trigger names, therefore queue on the chain
 * instead of each holding what the other waits for — a deadlock whose loser
 * was the producer's dispatch (swallowed by `emitEvent`'s savepoint: the
 * event's run silently never started), the streak (swallowed by its
 * savepoint below: the run went uncounted) or the landing run's audit row
 * (the terminal write rolled back, left to the sweep). The real-Postgres
 * lane `trigger-lock-order.integration.ts` holds both orders of producer,
 * both removals (the run door in the REST door's serializable transaction)
 * and a sweep whose batch no trigger names.
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

/** The trigger whose streak a landing run moves, or null when the run
 * leaves every streak alone: not a trigger's run, or a failure the next
 * occurrence might not repeat (a transient code, no code). */
function streakTriggerId(outcome: TriggerRunOutcome): string | null {
  const starter = parseRunStarter(outcome.startedBy);
  if (starter.kind !== 'trigger') return null;
  if (
    outcome.status !== 'success' &&
    !isPermanentFailureCode(outcome.failureCode)
  ) {
    return null;
  }
  return starter.triggerId;
}

/**
 * Keep the streak of the trigger that started a landing run — called by
 * `finishRun` after the run's audit row (the lock order in the module
 * note). Answers the automation whose trigger read changed — the caller
 * emits its definition hint so an open Trigger section refreshes — or null
 * when nothing did.
 */
export async function recordTriggerRunOutcome(
  tx: TransactionSql,
  outcome: TriggerRunOutcome,
): Promise<StreakChange> {
  const triggerId = streakTriggerId(outcome);
  if (triggerId === null) return null;
  try {
    return await tx.savepoint((sp) =>
      outcome.status === 'success'
        ? resetStreak(sp, triggerId, outcome)
        : countFailure(sp, triggerId, outcome),
    );
  } catch (error) {
    console.error(
      `[automations] run ${outcome.runId}: the failure streak of trigger ${triggerId} was not kept`,
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
  // A schedule its failures paused keeps the streak that paused it until
  // someone saves it: a run that overlapped the pause and succeeded after
  // it does not make the banner read "0 runs in a row failed". Paused is
  // off with the pause's stamp, as the banner reads it: a live schedule
  // that still carries the stamp (the module note) resets like any other.
  const reset = await tx<{ name: string }[]>`
    UPDATE app.automation_triggers SET consecutive_failures = 0
    WHERE id = ${triggerId} AND org_id = ${outcome.organizationId}
      AND consecutive_failures > 0
      AND (enabled OR last_skip_reason IS DISTINCT FROM 'paused_after_failures')
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
