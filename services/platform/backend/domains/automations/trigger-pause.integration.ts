/** Real Postgres proof: an always-failing schedule pauses itself after
 * `PERMANENT_FAILURES_BEFORE_PAUSE` occurrences — the scan fires it, the
 * harness worker steps each run to `failed` (`node_error`), and the run that
 * completes the streak turns the trigger off, audits the pause and notifies
 * the owner; the trigger read (`listTriggers`, behind the app, REST and MCP)
 * answers the pause with its streak and last failure, a success or a
 * permanent failure that lands after the pause leaves that streak and that
 * last failure alone, and a paused schedule fires nothing more. Saving it
 * again resumes it with a fresh streak and reads the notice, and a success
 * resets the streak — also on a schedule an older image turned back on
 * without clearing the pause's stamp (migration 0124,
 * `trigger-failures.ts`). */
import type { Sql } from 'postgres';

import { PERMANENT_FAILURES_BEFORE_PAUSE } from '../../core/automations/failure.ts';
import {
  deleteTrigger,
  deploy,
  listTriggers,
  saveVersion,
  setTrigger,
} from './store.ts';
import { recordTriggerRunOutcome } from './trigger-failures.ts';
import { scanScheduledTriggers } from './triggers.ts';

interface TriggerState {
  id: string;
  enabled: boolean;
  consecutiveFailures: number;
  lastSkipReason: string | null;
  lastFailureCode: string | null;
  lastFailedRunId: string | null;
  lastFailedAt: string | null;
  lastRunId: string | null;
}

const WAIT_MS = 30_000;

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return predicate();
}

export async function checkTriggerPauseAfterFailures(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const name = 'itest/pause-after-failures';
  const document = (code: string) => ({
    version: 1,
    name,
    nodes: [{ id: 'boom', type: 'transform', code }],
    output: '{{ nodes.boom.output }}',
  });

  const trigger = async (): Promise<TriggerState> => {
    const rows = await sql<TriggerState[]>`
      SELECT id, enabled, consecutive_failures AS "consecutiveFailures",
             last_skip_reason AS "lastSkipReason",
             last_failure_code AS "lastFailureCode",
             last_failed_run_id AS "lastFailedRunId",
             last_failed_at_ms::text AS "lastFailedAt",
             last_run_id AS "lastRunId"
      FROM app.automation_triggers
      WHERE org_id = ${orgId} AND name = ${name}
    `;
    const row = rows[0];
    if (row === undefined) throw new Error(`no trigger bound for ${name}`);
    return row;
  };
  const runStatus = async (runId: string): Promise<string | null> => {
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM app.automation_runs
      WHERE org_id = ${orgId} AND id = ${runId}
    `;
    return rows[0]?.status ?? null;
  };
  const triggerRuns = async (): Promise<number> => {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.automation_runs
      WHERE org_id = ${orgId} AND name = ${name}
        AND started_by LIKE 'trigger:%'
    `;
    return Number(rows[0]?.count ?? '0');
  };
  /** Make the next scan find the schedule due: its cursor is the later of
   * the claim and the fire stamp (0096), so both move back, and so does the
   * instant it is next due (0170) — a save or a fire set it ahead. */
  const backdate = (): Promise<unknown> => sql`
    UPDATE app.automation_triggers
    SET last_fired_at_ms = ${Date.now() - 120_000},
        last_due_at_ms = ${Date.now() - 120_000},
        next_due_at_ms = ${Date.now() - 60_000}
    WHERE org_id = ${orgId} AND name = ${name}
  `;
  /** Fire one occurrence and wait for the worker to land its run. */
  const fireOnce = async (): Promise<{ runId: string; status: string }> => {
    const before = (await trigger()).lastRunId;
    await backdate();
    await scanScheduledTriggers(sql);
    const runId = (await trigger()).lastRunId;
    if (runId === null || runId === before) {
      return { runId: runId ?? '', status: 'not_fired' };
    }
    await waitFor(async () => {
      const status = await runStatus(runId);
      return status === 'failed' || status === 'success';
    }, WAIT_MS);
    return { runId, status: (await runStatus(runId)) ?? 'missing' };
  };

  await saveVersion(sql, {
    organizationId: orgId,
    name,
    document: document(
      'throw new Error("itest: this automation always fails"); return null;',
    ),
    actor: userId,
  });
  await deploy(sql, { organizationId: orgId, name, version: 1, actor: userId });
  await setTrigger(sql, {
    organizationId: orgId,
    name,
    trigger: { kind: 'schedule', cron: '* * * * *', timezone: 'UTC' },
    actor: userId,
  });

  try {
    // ---- the streak: N occurrences, each a `node_error`; the Nth pauses.
    const outcomes: string[] = [];
    const streak: number[] = [];
    const enabled: boolean[] = [];
    const runIds: string[] = [];
    let lastRunId = '';
    for (let i = 0; i < PERMANENT_FAILURES_BEFORE_PAUSE; i++) {
      const fired = await fireOnce();
      runIds.push(fired.runId);
      lastRunId = fired.runId;
      outcomes.push(fired.status);
      const state = await trigger();
      streak.push(state.consecutiveFailures);
      enabled.push(state.enabled);
    }
    const paused = await trigger();
    const codes = await sql<{ failureCode: string | null }[]>`
      SELECT failure_code AS "failureCode" FROM app.automation_runs
      WHERE org_id = ${orgId} AND id = ${lastRunId}
    `;
    const expectedStreak = Array.from(
      { length: PERMANENT_FAILURES_BEFORE_PAUSE },
      (_, i) => i + 1,
    );
    const expectedEnabled = expectedStreak.map(
      (count) => count < PERMANENT_FAILURES_BEFORE_PAUSE,
    );
    record(
      `an always-failing schedule pauses itself after ${PERMANENT_FAILURES_BEFORE_PAUSE} occurrences`,
      outcomes.every((status) => status === 'failed') &&
        codes[0]?.failureCode === 'node_error' &&
        JSON.stringify(streak) === JSON.stringify(expectedStreak) &&
        JSON.stringify(enabled) === JSON.stringify(expectedEnabled) &&
        !paused.enabled &&
        paused.lastSkipReason === 'paused_after_failures' &&
        paused.lastFailureCode === 'node_error' &&
        paused.lastFailedRunId === lastRunId,
      `runs=${outcomes.join(',')} (want all failed, code ${codes[0]?.failureCode ?? 'none'}), streak=${streak.join(',')}, enabled=${enabled.join(',')}, after: enabled=${paused.enabled} reason=${paused.lastSkipReason} lastFailure=${paused.lastFailureCode}@${paused.lastFailedRunId === lastRunId ? 'last run' : paused.lastFailedRunId}`,
    );

    // ---- every reader sees the pause: the trigger read the app route, the
    // REST door, the Trigger section and the MCP view all go through.
    const [listed] = await listTriggers(sql, orgId, name);
    record(
      'the trigger read answers the pause, the streak and the last failure',
      listed !== undefined &&
        !listed.enabled &&
        listed.lastSkipReason === 'paused_after_failures' &&
        typeof listed.lastSkippedAt === 'number' &&
        listed.consecutiveFailures === PERMANENT_FAILURES_BEFORE_PAUSE &&
        listed.lastFailureCode === 'node_error' &&
        listed.lastFailedRunId === lastRunId &&
        typeof listed.lastFailedAt === 'number',
      `listTriggers → ${JSON.stringify(
        listed === undefined
          ? null
          : {
              enabled: listed.enabled,
              lastSkipReason: listed.lastSkipReason,
              lastSkippedAt: typeof listed.lastSkippedAt,
              consecutiveFailures: listed.consecutiveFailures,
              lastFailureCode: listed.lastFailureCode,
              lastFailedRun:
                listed.lastFailedRunId === lastRunId
                  ? 'last run'
                  : listed.lastFailedRunId,
              lastFailedAt: typeof listed.lastFailedAt,
            },
      )}`,
    );

    // ---- a run that overlapped the pause and succeeds after it leaves the
    // streak that paused the schedule alone.
    const overlapping = await sql.begin(async (tx) => ({
      change: await recordTriggerRunOutcome(tx, {
        organizationId: orgId,
        runId: lastRunId,
        startedBy: `trigger:${paused.id}`,
        startedAt: Date.now(),
        status: 'success',
        failureCode: null,
        now: Date.now(),
      }),
    }));
    const afterOverlap = await trigger();
    record(
      'a success landing after the pause keeps the streak that paused it',
      overlapping.change === null &&
        !afterOverlap.enabled &&
        afterOverlap.lastSkipReason === 'paused_after_failures' &&
        afterOverlap.consecutiveFailures === PERMANENT_FAILURES_BEFORE_PAUSE,
      `change=${JSON.stringify(overlapping.change)} (want null), enabled=${afterOverlap.enabled} reason=${afterOverlap.lastSkipReason} streak=${afterOverlap.consecutiveFailures} (want ${PERMANENT_FAILURES_BEFORE_PAUSE})`,
    );

    // ---- so does one that fails permanently after it: the paused schedule
    // keeps exactly the streak and the last failure that paused it, which
    // the banner names and **View run** opens. The pause writes no
    // `updated_at_ms`, so only the paused test holds this row back. The
    // stand-in run is a real one of this trigger (the streak's first), or
    // `last_failed_run_id`'s foreign key would refuse the write and the
    // streak's savepoint would swallow that instead.
    const lateFailure = await sql.begin(async (tx) => ({
      change: await recordTriggerRunOutcome(tx, {
        organizationId: orgId,
        runId: runIds[0] ?? '',
        startedBy: `trigger:${paused.id}`,
        startedAt: Date.now(),
        status: 'failed',
        failureCode: 'connector_error',
        now: Date.now(),
      }),
    }));
    const afterLateFailure = await trigger();
    record(
      'a permanent failure landing after the pause keeps the streak and the last failure that paused it',
      runIds[0] !== undefined &&
        runIds[0] !== lastRunId &&
        lateFailure.change === null &&
        !afterLateFailure.enabled &&
        afterLateFailure.lastSkipReason === 'paused_after_failures' &&
        afterLateFailure.consecutiveFailures ===
          PERMANENT_FAILURES_BEFORE_PAUSE &&
        afterLateFailure.lastFailureCode === 'node_error' &&
        afterLateFailure.lastFailedRunId === lastRunId &&
        afterLateFailure.lastFailedAt === paused.lastFailedAt,
      `change=${JSON.stringify(lateFailure.change)} (want null), enabled=${afterLateFailure.enabled} reason=${afterLateFailure.lastSkipReason} streak=${afterLateFailure.consecutiveFailures} (want ${PERMANENT_FAILURES_BEFORE_PAUSE}), lastFailure=${afterLateFailure.lastFailureCode}@${afterLateFailure.lastFailedRunId === lastRunId ? 'last run' : afterLateFailure.lastFailedRunId} (want node_error@last run), lastFailedAt ${afterLateFailure.lastFailedAt === paused.lastFailedAt ? 'kept' : `moved to ${afterLateFailure.lastFailedAt}`}`,
    );

    // ---- the pause is audited and the owner is told, once.
    const audits = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.audit_logs
      WHERE org_id = ${orgId} AND action = 'automation.trigger.paused'
        AND resource_type = 'automation_trigger' AND resource_id = ${paused.id}
    `;
    const notices = await sql<
      { read: boolean; params: Record<string, unknown> | null }[]
    >`
      SELECT read, params FROM app.user_notifications
      WHERE org_id = ${orgId} AND user_id = ${userId}
        AND type = 'automation_failed' AND resource_id = ${paused.id}
    `;
    const notice = notices.at(0);
    record(
      'a paused schedule writes one audit row and tells the owner',
      audits[0]?.count === '1' &&
        notices.length === 1 &&
        notice !== undefined &&
        !notice.read &&
        notice.params?.name === name &&
        notice.params.failures === PERMANENT_FAILURES_BEFORE_PAUSE &&
        notice.params.code === 'node_error' &&
        notice.params.trigger === true,
      `audit rows=${audits[0]?.count} (want 1), owner notices=${notices.length} (want 1, unread), params=${JSON.stringify(notice?.params ?? null)}`,
    );

    // ---- paused means paused: a due occurrence starts nothing.
    const runsBefore = await triggerRuns();
    await backdate();
    await scanScheduledTriggers(sql);
    const firedWhilePaused = (await triggerRuns()) - runsBefore;
    record(
      'a schedule its failures paused fires nothing more',
      firedWhilePaused === 0,
      `fired while paused=${firedWhilePaused} (want 0)`,
    );

    // ---- saving it again resumes it with a fresh streak and reads the
    // notice; the failures that follow count from one.
    await setTrigger(sql, {
      organizationId: orgId,
      name,
      trigger: {
        kind: 'schedule',
        cron: '* * * * *',
        timezone: 'UTC',
        enabled: true,
      },
      actor: userId,
    });
    const resumed = await trigger();
    const readNotices = await sql<{ read: boolean }[]>`
      SELECT read FROM app.user_notifications
      WHERE org_id = ${orgId} AND type = 'automation_failed'
        AND resource_id = ${paused.id}
    `;
    const afterResume = await fireOnce();
    const recounted = await trigger();
    record(
      'saving a paused schedule resumes it with a fresh streak and reads its notice',
      resumed.enabled &&
        resumed.consecutiveFailures === 0 &&
        resumed.lastSkipReason === null &&
        readNotices.length > 0 &&
        readNotices.every((row) => row.read) &&
        afterResume.status === 'failed' &&
        recounted.consecutiveFailures === 1 &&
        recounted.enabled,
      `after save: enabled=${resumed.enabled} streak=${resumed.consecutiveFailures} reason=${resumed.lastSkipReason} notices read=${readNotices.map((row) => row.read).join(',')}; next failure → ${afterResume.status}, streak=${recounted.consecutiveFailures} (want 1)`,
    );

    // ---- a success resets the streak.
    await saveVersion(sql, {
      organizationId: orgId,
      name,
      document: document('return { ok: true };'),
      actor: userId,
    });
    await deploy(sql, {
      organizationId: orgId,
      name,
      version: 2,
      actor: userId,
    });
    const success = await fireOnce();
    const reset = await trigger();
    record(
      'a successful run resets the failure streak',
      success.status === 'success' &&
        reset.consecutiveFailures === 0 &&
        reset.enabled &&
        reset.lastFailureCode === 'node_error',
      `run → ${success.status} (want success), streak=${reset.consecutiveFailures} (want 0), enabled=${reset.enabled}, last failure kept=${reset.lastFailureCode}`,
    );

    // A scan can already have read its walk when a landing run pauses one
    // of its schedules. Commit that pause immediately before the row's own
    // transaction starts: the decision reads the row as locked then, so the
    // stale walk must neither create a run nor clear the pause reason with
    // a fire stamp.
    await backdate();
    const beforeRacingPause = await triggerRuns();
    let pausedBeforeClaim = false;
    const racingScan = new Proxy(sql, {
      get(target, property, receiver) {
        if (property !== 'begin') {
          return Reflect.get(target, property, receiver);
        }
        const begin = target.begin.bind(target);
        return async (...args: unknown[]) => {
          if (!pausedBeforeClaim) {
            pausedBeforeClaim = true;
            await sql`
              UPDATE app.automation_triggers SET enabled = false,
                consecutive_failures = ${PERMANENT_FAILURES_BEFORE_PAUSE},
                last_skip_reason = 'paused_after_failures',
                last_skipped_at_ms = ${Date.now()}
              WHERE org_id = ${orgId} AND name = ${name}
            `;
          }
          return Reflect.apply(begin, target, args);
        };
      },
    });
    await scanScheduledTriggers(racingScan);
    const raced = await trigger();
    const racedRuns = (await triggerRuns()) - beforeRacingPause;
    record(
      'a schedule paused after the scan reads its walk is not claimed or fired',
      pausedBeforeClaim &&
        racedRuns === 0 &&
        !raced.enabled &&
        raced.lastSkipReason === 'paused_after_failures',
      `pause before claim=${pausedBeforeClaim}, new runs=${racedRuns} (want 0), enabled=${raced.enabled}, reason=${raced.lastSkipReason} (want paused_after_failures)`,
    );

    // ---- mid-roll, the image before 0124 turns the paused schedule back
    // on. Its bind knows no streak and keeps the skip stamps of an
    // unchanged kind, so the row goes live with the pause's stamp and the
    // count that paused it. Paused is off AND stamped: the next success
    // resets that count, or the schedule's failures would add up across
    // its successes and pause it again for failures that were not in a row.
    await sql`
      UPDATE app.automation_triggers
      SET enabled = true, updated_at_ms = ${Date.now()}
      WHERE org_id = ${orgId} AND name = ${name}
    `;
    const stale = await trigger();
    const lateSuccess = await fireOnce();
    const afterStale = await trigger();
    record(
      'a success on a live schedule still stamped paused by an older image resets its streak',
      stale.enabled &&
        stale.lastSkipReason === 'paused_after_failures' &&
        stale.consecutiveFailures === PERMANENT_FAILURES_BEFORE_PAUSE &&
        lateSuccess.status === 'success' &&
        afterStale.enabled &&
        afterStale.consecutiveFailures === 0,
      `before: enabled=${stale.enabled} reason=${stale.lastSkipReason} streak=${stale.consecutiveFailures} (want live, stamped, ${PERMANENT_FAILURES_BEFORE_PAUSE}); run → ${lateSuccess.status} (want success); after: enabled=${afterStale.enabled} streak=${afterStale.consecutiveFailures} (want 0), reason=${afterStale.lastSkipReason}`,
    );
  } finally {
    // Leave nothing armed for the lanes after this one.
    await deleteTrigger(sql, orgId, name, 'itest');
    await waitFor(async () => {
      const live = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM app.automation_runs
        WHERE org_id = ${orgId} AND name = ${name}
          AND status IN ('queued', 'running', 'waiting')
      `;
      return live[0]?.count === '0';
    }, WAIT_MS);
  }
}
