/**
 * Real Postgres proof for the decision door's resume: a committed approval
 * answers as committed when waking its parked run fails afterwards, and a
 * decision wakes its run exactly once — normal approve and reject, a
 * duplicate, two decisions racing, and a run cancelled first.
 *
 * The approvals are minted by the real gate for waiting runs of this lane,
 * and decided through the app door over HTTP. The one injected fault is the
 * last step of the wake: a trigger on the pg-boss job table refuses the
 * `automation.step` insert for a run named in `faulted`, so pg-boss's own
 * `send` rejects inside the poke. The same trigger holds every other step
 * job of these runs a day out, so the harness worker never picks one up and
 * each job stays countable.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

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
  const parked = async (): Promise<{
    runId: string;
    approvalId: string;
    gate: EvaluateApprovalGateArgs;
  }> => {
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO app.automation_runs
        (org_id, name, version, project_id, status, mode, started_by, input,
         detail, wake_at_ms, started_at_ms)
      VALUES (${orgId}, ${lane}, 1, NULL, 'waiting', 'live', 'user:itest',
              ${sql.json({ lane })}, 'approval:pending',
              ${Date.now() + 86_400_000}, ${Date.now()})
      RETURNING id
    `;
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
    await sql`
      UPDATE app.automation_runs SET detail = ${`approval:${approvalId}`}
      WHERE id = ${runId}
    `;
    return { runId, approvalId, gate };
  };
  const stepJobs = async (runId: string): Promise<number> => {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM pgboss.job
      WHERE name = 'automation.step' AND data->>'runId' = ${runId}
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
    WHERE name = 'automation.step'
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
      IF NEW.name = 'automation.step' THEN
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

  try {
    // --- The wake fails after the decision committed.
    const fault = await parked();
    await watch(fault.runId, true);
    const faulted = await decide(fault.approvalId, 'executing');
    const faultRow = await approvalOf(fault.approvalId);
    const faultAudits = await audits(fault.approvalId);
    const faultJobs = await stepJobs(fault.runId);
    const faultRun = await runStatus(fault.runId);
    record(
      'approval decision answers as committed when waking its run fails',
      fault.approvalId !== '' &&
        faulted.status === 200 &&
        faulted.body.ok === true &&
        faultRow?.status === 'executing' &&
        faultAudits === 1 &&
        faultJobs === 0 &&
        faultRun === 'waiting',
      `minted=${fault.approvalId !== ''}, decide → ${faulted.status} ${JSON.stringify(faulted.body)} (want 200 {ok:true}), row=${faultRow?.status} (want executing), audits=${faultAudits} (want 1), stepJobs=${faultJobs} (want 0), run=${faultRun} (want waiting: its own poll resumes it)`,
    );
    const retried = await decide(fault.approvalId, 'executing');
    const retriedJobs = await stepJobs(fault.runId);
    const gateAfter = await evaluateApprovalGate(sql, fault.gate);
    const consumed = await approvalOf(fault.approvalId);
    record(
      'approval decision after a failed wake: the retry and the gate agree with the 200',
      retried.status === 409 &&
        retried.body.error === 'ALREADY_RESOLVED' &&
        retriedJobs === 0 &&
        gateAfter.decision === 'allow' &&
        consumed?.status === 'completed',
      `retry → ${retried.status}/${retried.body.error} (want 409/ALREADY_RESOLVED), stepJobs=${retriedJobs} (want 0), gate=${gateAfter.decision} (want allow), row=${consumed?.status} (want completed)`,
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
        WHERE name = 'automation.step' AND data->>'runId' IN ${sql(runs)}
      `;
      await sql`
        UPDATE app.automation_runs
        SET status = 'cancelled', wake_at_ms = NULL,
            finished_at_ms = ${Date.now()}
        WHERE id IN ${sql(runs)} AND status IN ('queued', 'running', 'waiting')
      `;
    }
  }
}
