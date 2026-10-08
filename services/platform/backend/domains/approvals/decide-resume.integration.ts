import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { physicalTaskQueue } from '../../jobs/tasks.ts';
import { suspendRun } from '../automations/store.ts';
/**
 * Real Postgres proof for the decision door's resume: a decision and the
 * wake of its parked run commit together — a wake that cannot be queued
 * leaves the decision unrecorded, and deciding again records it — and a
 * decision wakes its run exactly once — normal approve and reject, a
 * duplicate, two decisions racing, and a run cancelled first. A decision
 * that lands while the run is still walking towards its park wakes it when
 * the park lands (`suspendRun`), instead of leaving it to the poll.
 *
 * The approvals are minted by the real gate for runs of this lane, and
 * decided through the app door over HTTP. The one injected fault is the
 * last step of the wake: a trigger on the pg-boss job table refuses the
 * `automation.step` insert for a run named in `faulted`, so pg-boss's own
 * `send` rejects inside the poke. The same trigger holds every other step
 * job of these runs a day out, so the harness worker never picks one up and
 * each job stays countable.
 */
import { markAutomationWriterInTx } from '../automations/writer-protocol.ts';
import { evaluateApprovalGate, type EvaluateApprovalGateArgs } from './gate.ts';

const decideAnswer = z.looseObject({
  ok: z.boolean().optional(),
  error: z.string().optional(),
});

export async function checkApprovalDecisionResume(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { cookie, orgId } = ctx;
  const lane = `itest-decide-resume-${randomUUID()}`;
  const decide = async (
    approvalId: string,
    status: 'executing' | 'rejected',
  ): Promise<{ status: number; body: { error?: string; ok?: boolean } }> => {
    const res = await fetch(
      `${base}/api/app/approvals/${approvalId}/decide?orgId=${orgId}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base },
        body: JSON.stringify({ status }),
      },
    );
    const parsed = decideAnswer.safeParse(await res.json().catch(() => null));
    return { status: res.status, body: parsed.success ? parsed.data : {} };
  };

  const runs: string[] = [];
  /** A run of this lane with its approval minted: parked on it, or still
   * walking towards that park (`running`, claimed at `WALKER_EPOCH`). */
  const WALKER_EPOCH = 3;
  const parked = async (
    status: 'waiting' | 'running' = 'waiting',
  ): Promise<{
    runId: string;
    approvalId: string;
    gate: EvaluateApprovalGateArgs;
  }> => {
    const inserted = await sql.begin(async (fixtureTx) => {
      await markAutomationWriterInTx(fixtureTx);
      return fixtureTx<{ id: string }[]>`
      INSERT INTO app.automation_runs
        (org_id, name, version, project_id, status, mode, started_by, input,
         detail, wake_at_ms, claim_epoch, started_at_ms)
      VALUES (${orgId}, ${lane}, 1, NULL, ${status}, 'live', 'user:itest',
              ${sql.json({ lane })},
              ${status === 'waiting' ? 'approval:pending' : null},
              ${Date.now() + 86_400_000}, ${WALKER_EPOCH}, ${Date.now()})
      RETURNING id
    `;
    });
    const runId = inserted[0]?.id ?? '';
    runs.push(runId);
    const gate: EvaluateApprovalGateArgs = {
      organizationId: orgId,
      source: 'automation',
      resourceKey: `${runId}:deliver`,
      connector: 'imap-smtp',
      action: 'send',
      effect: 'write',
      runId,
      nodeId: 'deliver',
      nodeType: 'imap-smtp.send',
      automation: lane,
      input: { to: 'itest-recipient@example.test' },
    };
    const minted = await evaluateApprovalGate(sql, gate);
    const approvalId =
      minted.decision === 'needs-approval' ? (minted.approvalId ?? '') : '';
    if (status === 'waiting') {
      await sql.begin(async (fixtureTx) => {
        await markAutomationWriterInTx(fixtureTx);
        return fixtureTx`
        UPDATE app.automation_runs SET detail = ${`approval:${approvalId}`}
        WHERE id = ${runId}
      `;
      });
    }
    return { runId, approvalId, gate };
  };
  /** The walker's park on the run's approval, as the stepper makes it. */
  const park = (runId: string, approvalId: string) =>
    suspendRun(sql, {
      organizationId: orgId,
      runId,
      epoch: WALKER_EPOCH,
      detail: `approval:${approvalId}`,
      executions: 1,
      resumeInMs: 600_000,
    });
  const pollJobs = async (runId: string): Promise<number> => {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM pgboss.job
      WHERE name = ${physicalTaskQueue('automation.poll')} AND data->>'runId' = ${runId}
        AND data->>'organizationId' = ${orgId}
    `;
    return Number(rows[0]?.count ?? '-1');
  };
  const wakeIn = async (runId: string): Promise<number> => {
    const rows = await sql<{ wakeAt: number | null }[]>`
      SELECT wake_at_ms::float8 AS "wakeAt" FROM app.automation_runs
      WHERE id = ${runId}
    `;
    return (rows[0]?.wakeAt ?? 0) - Date.now();
  };
  const stepJobs = async (runId: string): Promise<number> => {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM pgboss.job
      WHERE name = ${physicalTaskQueue('automation.step')} AND data->>'runId' = ${runId}
        AND data->>'organizationId' = ${orgId}
    `;
    return Number(rows[0]?.count ?? '-1');
  };
  const audits = async (approvalId: string): Promise<number> => {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.audit_logs
      WHERE org_id = ${orgId} AND category = 'workflow'
        AND action IN ('approve_request', 'reject_request')
        AND resource_id = ${approvalId}
    `;
    return Number(rows[0]?.count ?? '-1');
  };
  const approvalOf = async (
    approvalId: string,
  ): Promise<{ status: string; withdrawn: unknown } | null> => {
    const rows = await sql<{ status: string; withdrawn: unknown }[]>`
      SELECT status, metadata->'withdrawn' AS withdrawn
      FROM app.approvals WHERE id = ${approvalId}
    `;
    return rows[0] ?? null;
  };
  const runStatus = async (runId: string): Promise<string | undefined> =>
    (
      await sql<{ status: string }[]>`
        SELECT status FROM app.automation_runs WHERE id = ${runId}
      `
    )[0]?.status;

  // The step queue's table, as pg-boss created it for this deployment.
  const queue = await sql<{ table: string }[]>`
    SELECT table_name AS "table" FROM pgboss.queue
    WHERE name = ${physicalTaskQueue('automation.step')}
  `;
  const jobTable = queue[0]?.table ?? 'job';
  const faultTable = `itest_decide_resume_${randomUUID().replaceAll('-', '')}`;
  await sql.unsafe(`
    CREATE TABLE public.${faultTable} (
      run_id text PRIMARY KEY,
      faulted boolean NOT NULL DEFAULT false
    );
    CREATE FUNCTION public.${faultTable}_fn() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    DECLARE hit public.${faultTable};
    BEGIN
      IF NEW.name = '${physicalTaskQueue('automation.step')}' THEN
        SELECT * INTO hit FROM public.${faultTable}
        WHERE run_id = NEW.data->>'runId';
        IF FOUND AND hit.faulted THEN
          RAISE EXCEPTION 'itest: injected pg-boss send failure for run %',
            hit.run_id;
        ELSIF FOUND THEN
          NEW.start_after := now() + interval '1 day';
        END IF;
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER ${faultTable}_trg BEFORE INSERT ON pgboss.${jobTable}
      FOR EACH ROW EXECUTE FUNCTION public.${faultTable}_fn();
  `);
  const watch = async (runId: string, faulted = false): Promise<void> => {
    await sql.unsafe(
      `INSERT INTO public.${faultTable} (run_id, faulted) VALUES ($1, $2)`,
      [runId, faulted],
    );
  };
  const heal = async (runId: string): Promise<void> => {
    await sql.unsafe(
      `UPDATE public.${faultTable} SET faulted = false WHERE run_id = $1`,
      [runId],
    );
  };

  try {
    // --- The wake cannot be queued: the decision is not recorded either.
    const fault = await parked();
    await watch(fault.runId, true);
    // The door reports the refused send as the fault it is: an error line in
    // the log is this probe working, not failing.
    const faulted = await decide(fault.approvalId, 'executing');
    const faultRow = await approvalOf(fault.approvalId);
    const faultAudits = await audits(fault.approvalId);
    const faultJobs = await stepJobs(fault.runId);
    const faultRun = await runStatus(fault.runId);
    record(
      'approval decision whose wake cannot be queued records nothing',
      fault.approvalId !== '' &&
        faulted.status >= 500 &&
        faultRow?.status === 'pending' &&
        faultAudits === 0 &&
        faultJobs === 0 &&
        faultRun === 'waiting',
      `minted=${fault.approvalId !== ''}, decide → ${faulted.status} (want 5xx), row=${faultRow?.status} (want pending), audits=${faultAudits} (want 0), stepJobs=${faultJobs} (want 0), run=${faultRun} (want waiting)`,
    );
    await heal(fault.runId);
    const retried = await decide(fault.approvalId, 'executing');
    const retriedAudits = await audits(fault.approvalId);
    const retriedJobs = await stepJobs(fault.runId);
    const gateAfter = await evaluateApprovalGate(sql, fault.gate);
    const consumed = await approvalOf(fault.approvalId);
    record(
      'approval decision after a failed wake: deciding again records it and wakes the run once',
      retried.status === 200 &&
        retried.body.ok === true &&
        retriedAudits === 1 &&
        retriedJobs === 1 &&
        gateAfter.decision === 'allow' &&
        consumed?.status === 'completed',
      `retry → ${retried.status} ${JSON.stringify(retried.body)} (want 200 {ok:true}), audits=${retriedAudits} jobs=${retriedJobs} (want 1/1), gate=${gateAfter.decision} (want allow), row=${consumed?.status} (want completed)`,
    );

    // --- A decision that lands before the walker's park: the park wakes.
    const early = await parked('running');
    await watch(early.runId);
    const earlyDecision = await decide(early.approvalId, 'executing');
    const earlyJobsBefore = await stepJobs(early.runId);
    const earlyPark = await park(early.runId, early.approvalId);
    const earlyJobs = await stepJobs(early.runId);
    const earlyPolls = await pollJobs(early.runId);
    const earlyWake = await wakeIn(early.runId);
    record(
      'approval decided before its park: the park wakes the run at once [APV-R12]',
      earlyDecision.status === 200 &&
        earlyJobsBefore === 0 &&
        earlyPark.suspended &&
        earlyJobs === 1 &&
        earlyPolls === 0 &&
        earlyWake > 0 &&
        earlyWake <= 180_000,
      `decide → ${earlyDecision.status} (want 200), jobs before the park=${earlyJobsBefore} (want 0: the run was walking), parked=${earlyPark.suspended}, jobs=${earlyJobs} polls=${earlyPolls} (want 1/0), wake in ${Math.round(earlyWake / 1000)} s (want within the 180 s claim promise)`,
    );
    const pending = await parked('running');
    await watch(pending.runId);
    const pendingPark = await park(pending.runId, pending.approvalId);
    const pendingJobs = await stepJobs(pending.runId);
    const pendingPolls = await pollJobs(pending.runId);
    const pendingWake = await wakeIn(pending.runId);
    const pendingDecision = await decide(pending.approvalId, 'rejected');
    const pendingWoken = await stepJobs(pending.runId);
    record(
      'approval still pending at its park: a backstop poll, then the decision wakes it',
      pendingPark.suspended &&
        pendingJobs === 0 &&
        pendingPolls === 1 &&
        pendingWake > 540_000 &&
        pendingDecision.status === 200 &&
        pendingWoken === 1,
      `parked=${pendingPark.suspended}, jobs=${pendingJobs} polls=${pendingPolls} (want 0/1), wake in ${Math.round(pendingWake / 1000)} s (want about 600 s), decide → ${pendingDecision.status} (want 200), jobs after=${pendingWoken} (want 1)`,
    );

    // --- Controls: each decision wakes its own run exactly once.
    const approve = await parked();
    const reject = await parked();
    await watch(approve.runId);
    await watch(reject.runId);
    const approved = await decide(approve.approvalId, 'executing');
    const rejected = await decide(reject.approvalId, 'rejected');
    const approveJobs = await stepJobs(approve.runId);
    const rejectJobs = await stepJobs(reject.runId);
    const gateRejected = await evaluateApprovalGate(sql, reject.gate);
    record(
      'approval decisions wake their own run once each',
      approved.status === 200 &&
        rejected.status === 200 &&
        approveJobs === 1 &&
        rejectJobs === 1 &&
        gateRejected.decision === 'rejected',
      `approve → ${approved.status} jobs=${approveJobs}, reject → ${rejected.status} jobs=${rejectJobs} (want 200/1 each), gate on the rejected=${gateRejected.decision} (want rejected)`,
    );
    const duplicate = await decide(approve.approvalId, 'rejected');
    const duplicateJobs = await stepJobs(approve.runId);
    const duplicateAudits = await audits(approve.approvalId);
    const kept = await approvalOf(approve.approvalId);
    record(
      'approval duplicate decision refuses without a second job',
      duplicate.status === 409 &&
        duplicateJobs === 1 &&
        duplicateAudits === 1 &&
        kept?.status === 'executing',
      `duplicate → ${duplicate.status} (want 409), jobs=${duplicateJobs} audits=${duplicateAudits} (want 1/1), row=${kept?.status} (want executing)`,
    );

    const race = await parked();
    await watch(race.runId);
    const answers = await Promise.all([
      decide(race.approvalId, 'executing'),
      decide(race.approvalId, 'rejected'),
    ]);
    const statuses = answers
      .map((answer) => answer.status)
      .sort((a, b) => a - b);
    const raceAudits = await audits(race.approvalId);
    const raceJobs = await stepJobs(race.runId);
    record(
      'approval concurrent decisions: one wins, one audit, one job',
      statuses[0] === 200 &&
        statuses[1] === 409 &&
        raceAudits === 1 &&
        raceJobs === 1,
      `statuses=${statuses.join('/')} (want 200/409), audits=${raceAudits} jobs=${raceJobs} (want 1/1)`,
    );

    const cancelled = await parked();
    await watch(cancelled.runId);
    const stop = await fetch(
      `${base}/api/app/automations/runs/${cancelled.runId}/cancel?orgId=${orgId}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base },
        body: '{}',
      },
    );
    const withdrawn = await approvalOf(cancelled.approvalId);
    const late = await decide(cancelled.approvalId, 'executing');
    const lateJobs = await stepJobs(cancelled.runId);
    record(
      'approval on a cancelled run: withdrawn, and a late decision schedules nothing',
      stop.status === 200 &&
        withdrawn?.status === 'rejected' &&
        withdrawn.withdrawn === true &&
        late.status === 409 &&
        lateJobs === 0,
      `cancel → ${stop.status}, approval=${withdrawn?.status}/withdrawn=${String(withdrawn?.withdrawn)} (want rejected/true), late decide → ${late.status} (want 409), jobs=${lateJobs} (want 0)`,
    );
  } finally {
    // Leave nothing for the worker or a later lane: no trigger, no held
    // jobs, and every run of this lane settled.
    await sql.unsafe(`
      DROP TRIGGER IF EXISTS ${faultTable}_trg ON pgboss.${jobTable};
      DROP FUNCTION IF EXISTS public.${faultTable}_fn();
      DROP TABLE IF EXISTS public.${faultTable};
    `);
    if (runs.length > 0) {
      await sql`
        DELETE FROM pgboss.job
        WHERE name IN (${physicalTaskQueue('automation.step')}, ${physicalTaskQueue('automation.poll')})
          AND data->>'runId' IN ${sql(runs)}
      `;
      await sql.begin(async (fixtureTx) => {
        await markAutomationWriterInTx(fixtureTx);
        return fixtureTx`
        UPDATE app.automation_runs
        SET status = 'cancelled', wake_at_ms = NULL,
            finished_at_ms = ${Date.now()}
        WHERE id IN ${sql(runs)} AND status IN ('queued', 'running', 'waiting')
      `;
      });
    }
  }
}
