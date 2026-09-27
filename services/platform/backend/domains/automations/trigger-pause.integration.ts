/** Real Postgres proof: an always-failing schedule pauses itself after
 * `PERMANENT_FAILURES_BEFORE_PAUSE` occurrences — the scan fires it, the
 * harness worker steps each run to `failed` (`node_error`), and the run that
 * completes the streak turns the trigger off, audits the pause and notifies
 * the owner; a paused schedule fires nothing more. Saving it again resumes
 * it with a fresh streak and reads the notice, and a success resets the
 * streak (migration 0124, `trigger-failures.ts`). */
import type { Sql } from 'postgres';

import { PERMANENT_FAILURES_BEFORE_PAUSE } from '../../core/automations/failure.ts';
import { deleteTrigger, deploy, saveVersion, setTrigger } from './store.ts';
import { scanScheduledTriggers } from './triggers.ts';

interface TriggerState {
  id: string;
  enabled: boolean;
  consecutiveFailures: number;
  lastSkipReason: string | null;
  lastFailureCode: string | null;
  lastFailedRunId: string | null;
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
   * the claim and the fire stamp (0096), so both move back. */
  const backdate = (): Promise<unknown> => sql`
    UPDATE app.automation_triggers
    SET last_fired_at_ms = ${Date.now() - 120_000},
        last_due_at_ms = ${Date.now() - 120_000}
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
    let lastRunId = '';
    for (let i = 0; i < PERMANENT_FAILURES_BEFORE_PAUSE; i++) {
      const fired = await fireOnce();
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
  } finally {
    // Leave nothing armed for the lanes after this one.
    await deleteTrigger(sql, orgId, name);
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
