/** Real Postgres proof of the standing-role wake (#4540, migration 0168): a
 * worker's release in its agent's standing workspace records one pending
 * generation on the project's wake row, in the transaction of the run's end;
 * the wake scan fires the opted-in schedule T once, as an ordinary occurrence
 * whose start captures the generation; only that manager turn, launched and
 * settled, covers it — a queued cancel never does; a fault on the wake row
 * fails the run's end instead of losing the signal; and a release while the
 * agent's workspace is still busy does not signal (`slot-wakes.ts`,
 * `automations/wakes.ts`). An opted-out target keeps the generation and
 * fires it once when opted in again; an AUTO-R13 pause is mirrored as
 * `blocked` until a person's native save clears it; a closed circuit holds
 * the wake for its exact `retryAfter`, with no refusal row, and the same
 * generation fires once when the hour has passed. The schedule is opted in
 * through `setTrigger` (the managed door's store call). */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { deploy, saveVersion, setTrigger } from '../automations/store.ts';
import { fireDueProjectWakes } from '../automations/wakes.ts';
import {
  cancelAgentRunInTx,
  kickAgentRun,
  launchAgentRun,
  settleAgentRun,
} from './agent-runs.ts';
import {
  fixtures,
  holdAgentJobs,
  waitFor,
  type LaneCtx,
  type Recorder,
} from './delegated-start.integration.ts';

const WAIT_MS = 30_000;

interface WakeState {
  signalSeq: number;
  consumedSeq: number;
  firedSeq: number;
  firedRunId: string | null;
  attempts: number;
  notBefore: number | null;
  outcome: string | null;
}

export async function checkStandingRoleWake(
  sql: Sql,
  ctx: LaneCtx,
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const fx = fixtures(sql, ctx);
  const { suffix } = fx;
  const project = randomUUID();
  const manager = randomUUID();
  const worker = randomUUID();
  const name = `itest/wake-${suffix}`;
  const fault = `itest_wake_fault_${suffix}`;
  const release = await holdAgentJobs(sql, suffix, [project]);

  const wake = async (): Promise<WakeState | null> => {
    const rows = await sql<WakeState[]>`
      SELECT signal_seq::float8 AS "signalSeq",
             consumed_seq::float8 AS "consumedSeq",
             fired_seq::float8 AS "firedSeq", fired_run_id AS "firedRunId",
             attempts, not_before_ms::float8 AS "notBefore", outcome
      FROM app.project_wakes WHERE org_id = ${orgId} AND project_id = ${project}
    `;
    return rows[0] ?? null;
  };
  const show = (state: WakeState | null) => JSON.stringify(state);
  /** Let the schedule's minute be claimable again (the scan's own cursor). */
  const backdate = () => sql`
    UPDATE app.automation_triggers
    SET last_due_at_ms = ${Date.now() - 120_000}, last_fired_at_ms = NULL
    WHERE org_id = ${orgId} AND name = ${name}
  `;
  /** A worker's run in its standing workspace (the owner starts it). */
  const kickWorker = async (taskId: string) =>
    sql.begin((tx) =>
      kickAgentRun(tx, {
        organizationId: orgId,
        projectId: project,
        taskId,
        agentId: worker,
        harness: 'claude-code',
        model: 'itest-model',
        startedBy: userId,
      }),
    );
  const managerRuns = async () =>
    sql<
      {
        id: string;
        execId: string;
        status: string;
        captured: number | null;
      }[]
    >`
      SELECT id, exec_id AS "execId", status,
             wake_admitted_seq::float8 AS captured
      FROM app.project_agent_runs
      WHERE org_id = ${orgId} AND agent_id = ${manager}
      ORDER BY seq DESC
    `;
  /** Save T natively (a person's save), with or without the opt-in. */
  const optIn = (wakeOnSlotFreed: boolean | undefined) =>
    setTrigger(sql, {
      organizationId: orgId,
      name,
      trigger: {
        kind: 'schedule',
        cron: '0 0 1 1 *',
        timezone: 'UTC',
        enabled: true,
        ...(wakeOnSlotFreed === undefined ? {} : { wakeOnSlotFreed }),
      },
      actor: userId,
    });
  /** One worker release in the standing workspace: s + 1. */
  const releaseOnce = async (taskId: string) => {
    const run = await kickWorker(taskId);
    await settleAgentRun(sql, { runId: run.runId, resultText: 'done' });
  };
  /** Launch and settle the newest manager run: a served pass. */
  const serveNewest = async () => {
    const [newest] = await managerRuns();
    if (newest === undefined) return;
    await launchAgentRun(sql, { runId: newest.id, execId: newest.execId });
    await settleAgentRun(sql, { runId: newest.id, resultText: 'served' });
  };
  /** Fire the pending wake and wait for its occurrence to land. */
  const fireWake = async (): Promise<WakeState | null> => {
    await backdate();
    await fireDueProjectWakes(sql);
    const fired = await wake();
    const occurrence = fired?.firedRunId ?? null;
    if (occurrence !== null) {
      await waitFor(async () => {
        const rows = await sql<{ status: string }[]>`
          SELECT status FROM app.automation_runs WHERE id = ${occurrence}
        `;
        return ['success', 'failed', 'cancelled'].includes(
          rows[0]?.status ?? '',
        );
      }, WAIT_MS);
    }
    return fired;
  };

  try {
    await fx.insertProject(project, 'Wake project');
    await fx.insertAgent(manager, project, 'Fleet manager');
    await fx.insertAgent(worker, project, 'Implementer');
    const roleTask = await fx.insertTask({
      projectId: project,
      title: 'Standing role — manager',
      agentId: manager,
    });
    const workA = await fx.insertTask({
      projectId: project,
      title: 'Worker card A',
      agentId: worker,
    });
    const workB = await fx.insertTask({
      projectId: project,
      title: 'Worker card B',
      agentId: worker,
    });
    await saveVersion(sql, {
      organizationId: orgId,
      name,
      document: {
        version: 1,
        name,
        nodes: [
          {
            id: 'start',
            type: 'task.start_agent',
            input: { taskId: roleTask, moveToInProgress: false },
          },
        ],
        output: '{{ nodes.start.output }}',
      },
      actor: userId,
      projectId: project,
    });
    await deploy(sql, {
      organizationId: orgId,
      name,
      version: 1,
      actor: userId,
    });
    // A yearly cron: only wakes fire T during the lane.
    await optIn(true);

    // ---- W13: a release while the workspace is busy does not signal ------
    const a = await kickWorker(workA);
    const b = await kickWorker(workB);
    await launchAgentRun(sql, { runId: b.runId, execId: b.execId });
    await settleAgentRun(sql, { runId: a.runId, resultText: 'done A' });
    const busy = await wake();
    record(
      'standing-role wake: a release while another run holds the workspace records nothing (W13)',
      busy === null || busy.signalSeq === 0,
      `wake=${show(busy)} (want no row or signal 0)`,
    );

    // ---- W9: a fault on the wake row fails the run's end, losing nothing --
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION app.${fault}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'itest wake fault';
      END $$ LANGUAGE plpgsql
    `);
    await sql.unsafe(`
      CREATE TRIGGER ${fault} BEFORE INSERT OR UPDATE ON app.project_wakes
      FOR EACH ROW EXECUTE FUNCTION app.${fault}()
    `);
    let threw = false;
    try {
      await settleAgentRun(sql, { runId: b.runId, resultText: 'done B' });
    } catch (error) {
      threw = String(error).includes('itest wake fault');
    } finally {
      await sql.unsafe(`DROP TRIGGER IF EXISTS ${fault} ON app.project_wakes`);
      await sql.unsafe(`DROP FUNCTION IF EXISTS app.${fault}()`);
    }
    const stillLive = await sql<{ status: string; ledger: number }[]>`
      SELECT r.status,
             (SELECT count(*)::int FROM app.audit_logs l
              WHERE l.org_id = ${orgId} AND l.resource_id = ${b.runId}
                AND l.action = 'agent.run_settled') AS ledger
      FROM app.project_agent_runs r WHERE r.id = ${b.runId}
    `;
    const settledAfter = await settleAgentRun(sql, {
      runId: b.runId,
      resultText: 'done B',
    });
    const signalled = await wake();
    record(
      'standing-role wake: a wake-row fault fails the run’s end; the retried end records the release once (W9, F1)',
      threw &&
        stillLive[0]?.status === 'running' &&
        stillLive[0]?.ledger === 0 &&
        settledAfter &&
        signalled?.signalSeq === 1 &&
        signalled.consumedSeq === 0,
      `threw=${threw} run=${JSON.stringify(stillLive[0])} settled=${settledAfter} wake=${show(signalled)} (want threw, running with no ledger, then settled and signal 1 / consumed 0)`,
    );

    // ---- W1: one fire, the start captures it, a served pass covers it -----
    const fired = await fireWake();
    const [m1] = await managerRuns();
    record(
      'standing-role wake: a pending release fires T once and its manager start captures the generation (W1)',
      // The in-process scan may already have classified it as admitted.
      (fired?.outcome === 'fired' || fired?.outcome === 'admitted') &&
        fired.firedSeq === 1 &&
        m1 !== undefined &&
        m1.captured === 1 &&
        m1.status === 'queued',
      `wake=${show(fired)} manager=${JSON.stringify(m1)} (want fired 1, a queued manager run capturing 1)`,
    );
    await backdate();
    await fireDueProjectWakes(sql);
    const runsWhileLive = await managerRuns();
    const held = await wake();
    record(
      'standing-role wake: no second fire while the manager is live; nothing consumed yet (W1)',
      runsWhileLive.length === 1 &&
        held?.consumedSeq === 0 &&
        held.signalSeq === 1,
      `manager runs=${runsWhileLive.length} wake=${show(held)} (want 1 run, consumed 0)`,
    );
    if (m1 !== undefined) {
      await launchAgentRun(sql, { runId: m1.id, execId: m1.execId });
      await settleAgentRun(sql, { runId: m1.id, resultText: 'served' });
    }
    const served = await wake();
    record(
      'standing-role wake: the launched and settled manager turn covers what it captured (W1, D6)',
      served?.outcome === 'served' &&
        served.consumedSeq === 1 &&
        served.signalSeq === 1 &&
        served.attempts === 0,
      `wake=${show(served)} (want served, consumed 1 of 1, attempts 0)`,
    );

    // ---- W18: a queued cancel keeps the generation and backs off ----------
    const c = await kickWorker(workA);
    await settleAgentRun(sql, { runId: c.runId, resultText: 'done C' });
    await fireWake();
    const [m2] = await managerRuns();
    const cancelledAt = Date.now();
    if (m2 !== undefined) {
      await sql.begin((tx) =>
        cancelAgentRunInTx(tx, {
          organizationId: orgId,
          runId: m2.id,
          taskId: roleTask,
        }),
      );
    }
    const cancelled = await wake();
    record(
      'standing-role wake: a queued manager cancel consumes nothing and waits the first backoff step (W18)',
      m2 !== undefined &&
        m2.captured === 2 &&
        cancelled?.outcome === 'manager_cancelled' &&
        cancelled.consumedSeq === 1 &&
        cancelled.signalSeq === 2 &&
        cancelled.attempts === 1 &&
        cancelled.notBefore !== null &&
        cancelled.notBefore >= cancelledAt + 60_000,
      `manager=${JSON.stringify(m2)} wake=${show(cancelled)} (want consumed 1 of 2, attempts 1, not before cancel + 60 s)`,
    );

    // ---- W17: an opted-out target keeps the generation; opting in fires it
    // Opt out first, so no in-process scan tick can fire in between.
    await optIn(false);
    await sql`
      UPDATE app.project_wakes SET not_before_ms = NULL
      WHERE org_id = ${orgId} AND project_id = ${project}
    `;
    await backdate();
    await fireDueProjectWakes(sql);
    const optedOut = await wake();
    const runsOptedOut = (await managerRuns()).length;
    await optIn(true);
    const refired = await fireWake();
    const [m3] = await managerRuns();
    await serveNewest();
    const servedAgain = await wake();
    record(
      'standing-role wake: an opted-out target keeps its generation and fires it once when opted in again (W17)',
      optedOut?.outcome === 'target_disabled' &&
        optedOut.signalSeq === 2 &&
        optedOut.consumedSeq === 1 &&
        runsOptedOut === 2 &&
        refired?.firedSeq === 2 &&
        m3?.captured === 2 &&
        servedAgain?.outcome === 'served' &&
        servedAgain.consumedSeq === 2,
      `opted out=${show(optedOut)} runs=${runsOptedOut} refired=${show(refired)} manager=${JSON.stringify(m3)} served=${show(servedAgain)} (want target_disabled 2/1 with 2 runs, then fired 2, captured 2, served 2/2)`,
    );

    // ---- W8b (b) + W11: blocked by AUTO-R13; a native save clears it; the
    // closed circuit then holds the wake for its exact retryAfter ---------
    await sql`
      UPDATE app.automation_triggers
      SET enabled = false, last_skip_reason = 'paused_after_failures',
          last_skipped_at_ms = ${Date.now()}, last_failure_code = 'node_error',
          consecutive_failures = 5
      WHERE org_id = ${orgId} AND name = ${name}
    `;
    await releaseOnce(workB);
    await backdate();
    await fireDueProjectWakes(sql);
    const blocked = await wake();
    record(
      'standing-role wake: a schedule paused by AUTO-R13 mirrors as blocked with its cause, firing nothing (W8b)',
      blocked?.outcome === 'blocked' &&
        blocked.signalSeq === 3 &&
        blocked.consumedSeq === 2 &&
        (await managerRuns()).length === 3,
      `wake=${show(blocked)} (want blocked, signal 3 / consumed 2, still 3 manager runs)`,
    );
    const reason = await sql<{ reason: string | null }[]>`
      SELECT blocked_reason AS reason FROM app.project_wakes
      WHERE org_id = ${orgId} AND project_id = ${project}
    `;
    // A person's native save (the app's trigger Save → non-managed
    // setTrigger), which omits the opt-in and so keeps it.
    await optIn(undefined);
    const recovered = await sql<
      {
        enabled: boolean;
        skip: string | null;
        streak: number;
        wakes: boolean;
      }[]
    >`
      SELECT enabled, last_skip_reason AS skip,
             consecutive_failures AS streak, wake_on_slot_freed AS wakes
      FROM app.automation_triggers WHERE org_id = ${orgId} AND name = ${name}
    `;
    const circuitStarts = await sql<{ oldest: number | null; count: number }[]>`
      SELECT min(started_at_ms)::float8 AS oldest, count(*)::int AS count
      FROM app.project_agent_runs
      WHERE org_id = ${orgId} AND task_id = ${roleTask}
        AND started_via IS NOT NULL
        AND started_at_ms > ${Date.now() - 60 * 60_000}
    `;
    await backdate();
    await fireDueProjectWakes(sql);
    const circuitHeld = await wake();
    const refusals = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.task_activity
      WHERE task_id = ${roleTask} AND to_value = 'task_circuit_breaker'
    `;
    const oldest = circuitStarts[0]?.oldest ?? null;
    record(
      'standing-role wake: a native save clears the pause and keeps the opt-in; the closed circuit holds the wake for its exact retryAfter with no refusal row (W8b, W11)',
      reason[0]?.reason === 'paused_after_failures:node_error' &&
        recovered[0] !== undefined &&
        recovered[0].enabled &&
        recovered[0].skip === null &&
        recovered[0].streak === 0 &&
        recovered[0].wakes &&
        circuitStarts[0]?.count === 3 &&
        oldest !== null &&
        circuitHeld?.outcome === 'paused' &&
        circuitHeld.notBefore === oldest + 60 * 60_000 &&
        (await managerRuns()).length === 3 &&
        refusals[0]?.count === 0,
      `reason=${reason[0]?.reason} trigger=${JSON.stringify(recovered[0])} circuit=${JSON.stringify(circuitStarts[0])} wake=${show(circuitHeld)} refusals=${refusals[0]?.count} (want the cause named, the pause cleared with the opt-in kept, paused until oldest start + 1 h, no new run, no refusal row)`,
    );

    // ---- once the hour has passed: exactly one fire, served --------------
    await sql`
      UPDATE app.project_agent_runs
      SET started_at_ms = started_at_ms - ${2 * 60 * 60_000}
      WHERE org_id = ${orgId} AND task_id = ${roleTask}
    `;
    await sql`
      UPDATE app.project_wakes SET not_before_ms = ${Date.now() - 1}
      WHERE org_id = ${orgId} AND project_id = ${project}
    `;
    await fireWake();
    const afterHour = await managerRuns();
    await serveNewest();
    const recoveredServed = await wake();
    record(
      'standing-role wake: after the circuit’s hour the same generation fires exactly once and is served (W8b, W11)',
      afterHour.length === 4 &&
        afterHour[0]?.captured === 3 &&
        recoveredServed?.outcome === 'served' &&
        recoveredServed.consumedSeq === 3 &&
        recoveredServed.attempts === 0,
      `manager runs=${afterHour.length} newest=${JSON.stringify(afterHour[0])} wake=${show(recoveredServed)} (want 4 runs, the newest capturing 3, served 3/3)`,
    );
  } finally {
    await release();
    await sql`DELETE FROM app.project_wakes WHERE org_id = ${orgId} AND project_id = ${project}`;
    await sql`DELETE FROM app.automation_triggers WHERE org_id = ${orgId} AND name = ${name}`;
  }
}
