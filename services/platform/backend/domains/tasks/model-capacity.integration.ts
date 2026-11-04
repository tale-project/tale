/** Real PostgreSQL custody of a model at capacity: the run the provider
 * refused fails once, opens the model's hold and arms a free retry; a run on
 * the held model parks instead of starting; a probe whose harness retries a
 * refused call holds the model until its own refusal doubles the wait; a run
 * that settles on the model clears the hold and wakes it; the hourly circuit
 * counts none of it. Tasks stay To do so normal retry workers refuse them,
 * and every start the lane kicks waits an hour in the queue, so no worker can
 * launch a fixture. */
import { randomUUID } from 'node:crypto';

import type { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';

import { resolveAutoRetryBudget } from '../../core/tasks/task_auto_retry.ts';
import { bossDbInTx } from '../../jobs/enqueue.ts';
import {
  failAgentRunFromTurn,
  kickAgentRun,
  renewAgentRunCapacityProbe,
  settleAgentRun,
} from './agent-runs.ts';
import { claimAgentWorker } from './agent-workers.ts';
import { admitAutomatedStart } from './delegated-start.ts';
import { loadTaskRetryHistory, resolveTaskKickStartArgs } from './kick-plan.ts';
import {
  admitModelCapacityInTx,
  MODEL_CAPACITY_MAX_WAIT_MS,
  MODEL_CAPACITY_PROBE_PROOF_MS,
  MODEL_CAPACITY_WAKE_SPACING_MS,
  modelCapacityKey,
  PARKED_ON_HELD_MODEL_SQL,
  readModelCapacityHold,
  readModelCapacityRamps,
  renewModelCapacityProbeInTx,
} from './model-capacity-holds.ts';

export async function checkModelCapacityRetry(
  sql: Sql,
  boss: PgBoss,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const projectId = randomUUID();
  const agentId = randomUUID();
  const taskId = randomUUID();
  const otherTaskId = randomUUID();
  // A model of this lane's own: a hold is the organization's, by model.
  const model = `itest-capacity-${randomUUID().slice(0, 8)}`;
  const key = { organizationId: orgId, modelProvider: null, model };
  const sessionId = `pa-${agentId}`;
  const now = Date.now();
  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
    VALUES (${projectId}, ${orgId}, 'Model capacity', ${userId}, ${now}, ${now})
  `;
  await sql`
    INSERT INTO app.project_agents (id, org_id, project_id, name, harness, model,
      created_by, created_at_ms, updated_at_ms)
    VALUES (${agentId}, ${orgId}, ${projectId}, 'Capacity agent', 'codex',
      ${model}, ${userId}, ${now}, ${now})
  `;
  for (const [id, title] of [
    [taskId, 'Capacity retry'],
    [otherTaskId, 'Capacity neighbour'],
  ] as const) {
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, assignee_type,
        assignee_id, rank, created_by, created_by_type, created_at_ms, updated_at_ms)
      VALUES (${id}, ${orgId}, ${projectId}, ${title}, 'todo',
        'agent', ${agentId}, 'a0', ${userId}, 'user', ${now}, ${now})
    `;
  }
  const addRun = async (task = taskId) => {
    const at = Date.now();
    const execId = randomUUID();
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, started_by, broker_token_hash, trigger,
        started_via, started_via_run_id, started_via_agent_id,
        started_at_ms, launched_at_ms, deadline_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${task}, ${agentId}, ${execId}, ${sessionId},
        'running', 'codex', ${model}, ${userId}, 'healthy-account', 'delegated',
        'agent', 'itest-manager-run', ${agentId},
        ${at - 2_000}, ${at - 1_000}, ${at + 3_600_000}, ${at}
      ) RETURNING id
    `;
    const runId = rows[0]?.id;
    if (runId === undefined) throw new Error('itest: capacity run missing');
    return { runId, execId };
  };
  const fail = (run: { runId: string; execId: string }) =>
    failAgentRunFromTurn(sql, {
      ...run,
      error: 'Selected model is at capacity. Please try a different model.',
      failureCode: 'model_capacity',
      agentSessionId: 'capacity-conversation',
    });
  try {
    const first = await addRun();
    const stale = await fail({ ...first, execId: 'stale-exec' });
    const won = await fail(first);
    const duplicate = await fail(first);
    const rows = await sql<
      {
        failureCode: string;
        status: string;
        settledAt: number;
        startAfter: string | null;
      }[]
    >`
      SELECT r.failure_code AS "failureCode", r.status,
        r.settled_at_ms::float8 AS "settledAt",
        j.data ->> 'startAfterMs' AS "startAfter"
      FROM app.project_agent_runs r
      JOIN pgboss.job j ON j.name = 'task.agent_retry'
        AND j.data ->> 'expectedRunId' = r.id
      WHERE r.id = ${first.runId}
    `;
    const row = rows[0];
    const hold = await readModelCapacityHold(sql, key);
    record(
      'model capacity: one exec-fenced refusal arms one retry and holds the model for about a minute [TASK-R40]',
      !stale &&
        won &&
        !duplicate &&
        rows.length === 1 &&
        row?.failureCode === 'model_capacity' &&
        row.status === 'failed' &&
        row.startAfter === null &&
        hold !== null &&
        hold.consecutive === 1 &&
        hold.heldUntilMs >= row.settledAt + 54_000 &&
        hold.heldUntilMs <= row.settledAt + 66_000,
      `stale=${stale} won=${won} duplicate=${duplicate} rows=${JSON.stringify(rows)} hold=${JSON.stringify(hold)}`,
    );
    if (row === undefined || hold === null)
      throw new Error('itest: capacity hold missing');

    const history = await loadTaskRetryHistory(sql, taskId);
    const budget = resolveAutoRetryBudget(history);
    const plan = await resolveTaskKickStartArgs(sql, {
      organizationId: orgId,
      taskId,
      agentId,
      sessionId,
      harness: 'codex',
    });
    record(
      'model capacity: the retry spends no attempt and keeps its account eligible [TASK-R40]',
      budget.retry &&
        budget.attempt === 0 &&
        plan.excludeBrokerTokenHashes === undefined,
      `budget=${JSON.stringify(budget)} excluded=${JSON.stringify(plan.excludeBrokerTokenHashes)}`,
    );

    // The retry's start: kicked with its turn job an hour out, so no worker
    // takes it, then claimed here the way its turn job claims it.
    const kicked = await sql.begin((tx) =>
      kickAgentRun(tx, {
        organizationId: orgId,
        projectId,
        taskId,
        agentId,
        harness: 'codex',
        model,
        startedBy: userId,
        trigger: 'auto_retry',
        autoRetryAttempt: 0,
        startAfterMs: Date.now() + 3_600_000,
      }),
    );
    const execOf = await sql<{ execId: string }[]>`
      SELECT exec_id AS "execId" FROM app.project_agent_runs WHERE id = ${kicked.runId}
    `;
    const retryExec = execOf[0]?.execId ?? kicked.execId;
    const claim = await claimAgentWorker(sql, {
      organizationId: orgId,
      runId: kicked.runId,
      execId: retryExec,
    });
    const parked = await sql<
      { reason: string | null; parked: boolean; wakeAt: Date | null }[]
    >`
      SELECT r.waiting_reason AS reason,
             r.waiting_for_capacity_at_ms IS NOT NULL AS parked,
             (SELECT j.start_after FROM pgboss.job j
              WHERE j.name = 'task.agent_park_wake'
                AND j.data ->> 'runId' = r.id
              ORDER BY j.created_on DESC LIMIT 1) AS "wakeAt"
      FROM app.project_agent_runs r WHERE r.id = ${kicked.runId}
    `;
    const park = parked[0];
    record(
      'model capacity: a run on the held model parks with its reason until the hold runs out [TASK-R40]',
      claim !== null &&
        'parked' in claim &&
        claim.parked === 'model_capacity' &&
        park !== undefined &&
        park.parked &&
        park.reason === 'model_capacity' &&
        park.wakeAt !== null &&
        Math.abs(park.wakeAt.getTime() - hold.heldUntilMs) < 5_000,
      `claim=${JSON.stringify(claim)} park=${JSON.stringify(park)} heldUntil=${hold.heldUntilMs}`,
    );
    const leftAlone = await sql<{ onHeldModel: boolean }[]>`
      SELECT ${sql.unsafe(PARKED_ON_HELD_MODEL_SQL)} AS "onHeldModel"
      FROM app.project_agent_runs r WHERE r.id = ${kicked.runId}
    `;
    record(
      'model capacity: the generic wakes leave a run parked on a held model alone [TASK-R40]',
      leftAlone[0] !== undefined && leftAlone[0].onHeldModel,
      `leftAlone=${JSON.stringify(leftAlone)}`,
    );

    // Runs that were already working when the model saturated fail in a
    // burst: the hold stays as it is. Three refusals close no circuit.
    await fail(await addRun(otherTaskId));
    await fail(await addRun(otherTaskId));
    const burst = await readModelCapacityHold(sql, key);
    const admission = await sql.begin((tx) =>
      admitAutomatedStart(tx, {
        task: { id: otherTaskId, organizationId: orgId, projectId },
        agentId,
      }),
    );
    record(
      'model capacity: refusals in a burst keep the hold and close no hourly circuit [TASK-R12]',
      burst !== null &&
        burst.consecutive === 1 &&
        burst.heldUntilMs === hold.heldUntilMs &&
        admission.admitted,
      `burst=${JSON.stringify(burst)} admission=${JSON.stringify(admission)}`,
    );

    // The probe's harness meets the refusal and retries the call itself, the
    // way Claude Code 2.1.285 retries a 503: each retry at its offset into
    // the claim, with its wait before the next call. Three minutes in, its
    // eleventh call is refused too and it gives up. The clock is the hold's:
    // the probe claims as the hold runs out.
    const probe = await addRun(otherTaskId);
    const claimedAt = hold.heldUntilMs;
    const probing = await sql.begin((tx) =>
      admitModelCapacityInTx(tx, {
        ...key,
        runId: probe.runId,
        now: claimedAt,
      }),
    );
    const renew = async (at: number, retryDelayMs: number) => {
      const renewed = await sql.begin((tx) =>
        renewModelCapacityProbeInTx(tx, {
          ...key,
          runId: probe.runId,
          retryDelayMs,
          now: claimedAt + at,
        }),
      );
      const renewedHold = await readModelCapacityHold(sql, key);
      return renewed ? (renewedHold?.probeClaimedAtMs ?? null) : null;
    };
    // A run on the model whose wake comes due meanwhile.
    const neighbourRunId = randomUUID();
    const neighbourClaims = (at: number) =>
      sql.begin((tx) =>
        admitModelCapacityInTx(tx, {
          ...key,
          runId: neighbourRunId,
          now: claimedAt + at,
        }),
      );
    const claims: Array<number | null> = [];
    for (const [at, retryDelayMs] of [
      // A wait printed with a fraction is credited in whole milliseconds.
      [0, 600.4],
      [600, 1_100],
      [1_700, 2_200],
      [3_900, 4_500],
      [8_400, 9_000],
      [17_400, 18_000],
      [35_400, 36_000],
      [71_400, 36_000],
      [107_400, 36_000],
    ] as const) {
      claims.push(await renew(at, retryDelayMs));
    }
    // Two minutes in: a probe nothing renewed would have proved the model.
    const atTwoMinutes = await neighbourClaims(2 * 60_000);
    claims.push(await renew(143_400, 36_600));
    const asItGivesUp = await neighbourClaims(3 * 60_000);
    const standing = await readModelCapacityHold(sql, key);
    const renewedClaims = [
      600, 1_700, 3_900, 8_400, 17_400, 35_400, 71_400, 107_400, 143_400,
      180_000,
    ].map((at) => claimedAt + at);
    record(
      'model capacity: a probe its harness retries holds the model, and the others wait until two minutes past its last refused call [TASK-R40]',
      probing.admitted &&
        probing.probe &&
        JSON.stringify(claims) === JSON.stringify(renewedClaims) &&
        !atTwoMinutes.admitted &&
        atTwoMinutes.wakeAtMs ===
          claimedAt + 143_400 + MODEL_CAPACITY_PROBE_PROOF_MS &&
        !asItGivesUp.admitted &&
        asItGivesUp.wakeAtMs ===
          claimedAt + 180_000 + MODEL_CAPACITY_PROBE_PROOF_MS &&
        standing !== null &&
        standing.probeRunId === probe.runId &&
        standing.consecutive === 1,
      `probing=${JSON.stringify(probing)} claims=${JSON.stringify(claims)} claimedAt=${claimedAt} atTwoMinutes=${JSON.stringify(atTwoMinutes)} asItGivesUp=${JSON.stringify(asItGivesUp)} standing=${JSON.stringify(standing)}`,
    );

    // The turn host's renewal: only the probe's current exec renews, and a
    // renewal never moves the claim earlier.
    const staleRenewal = await renewAgentRunCapacityProbe(sql, {
      runId: probe.runId,
      execId: 'stale-exec',
      retryDelayMs: 566,
    });
    const liveRenewal = await renewAgentRunCapacityProbe(sql, {
      runId: probe.runId,
      execId: probe.execId,
      retryDelayMs: 566,
    });
    const kept = await readModelCapacityHold(sql, key);
    record(
      'model capacity: only the probe’s current exec renews its claim, and never to earlier [TASK-R40]',
      !staleRenewal &&
        liveRenewal &&
        kept?.probeClaimedAtMs === claimedAt + 180_000,
      `stale=${staleRenewal} live=${liveRenewal} kept=${JSON.stringify(kept)}`,
    );

    // The probe's own refusal, as its harness gives up, finds the hold: the
    // wait doubles, and the twelve hours still count from the first refusal.
    const gaveUp = await fail(probe);
    const doubled = await readModelCapacityHold(sql, key);
    const probeRows = await sql<{ armed: boolean }[]>`
      SELECT auto_retry_armed_at_ms IS NOT NULL AS armed
      FROM app.project_agent_runs WHERE id = ${probe.runId}
    `;
    const afterRefusal = await renewAgentRunCapacityProbe(sql, {
      runId: probe.runId,
      execId: probe.execId,
      retryDelayMs: 566,
    });
    const doubledWait =
      doubled === null ? null : doubled.heldUntilMs - doubled.lastRefusedAtMs;
    record(
      'model capacity: the probe’s refusal when its harness gives up doubles the wait of the same hold [TASK-R40]',
      gaveUp &&
        doubled !== null &&
        doubled.consecutive === 2 &&
        doubled.firstRefusedAtMs === hold.firstRefusedAtMs &&
        doubled.probeRunId === null &&
        doubled.probeClaimedAtMs === null &&
        doubledWait !== null &&
        doubledWait >= 108_000 &&
        doubledWait <= 132_000 &&
        probeRows[0] !== undefined &&
        probeRows[0].armed &&
        !afterRefusal,
      `gaveUp=${gaveUp} doubled=${JSON.stringify(doubled)} firstRefusedAt=${hold.firstRefusedAtMs} probe=${JSON.stringify(probeRows)} afterRefusal=${afterRefusal}`,
    );

    // A run on the model that settles proves it answers: the hold goes and
    // the parked retry is woken.
    const answered = await addRun(otherTaskId);
    const settling = Date.now();
    const settled = await settleAgentRun(sql, {
      runId: answered.runId,
      execId: answered.execId,
      resultText: 'done',
    });
    const cleared = await readModelCapacityHold(sql, key);
    const wakes = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pgboss.job
      WHERE name = 'task.agent_park_wake' AND data ->> 'runId' = ${kicked.runId}
    `;
    // New work on the model ramps up from the clear: the one run its first
    // wave lets through has not started yet.
    const ramps = await readModelCapacityRamps(sql, {
      organizationId: orgId,
      now: Date.now(),
    });
    const ramp = ramps.get(modelCapacityKey(key));
    record(
      'model capacity: a run that settles on the model clears its hold, wakes the runs parked on it and starts its ramp [TASK-R40] [TASK-R43]',
      settled &&
        cleared === null &&
        (wakes[0]?.n ?? 0) >= 2 &&
        ramp !== undefined &&
        ramp.room === 1 &&
        ramp.nextWaveAtMs >= settling + MODEL_CAPACITY_WAKE_SPACING_MS &&
        ramp.nextWaveAtMs <= Date.now() + MODEL_CAPACITY_WAKE_SPACING_MS,
      `settled=${settled} cleared=${JSON.stringify(cleared)} wakes=${wakes[0]?.n} ramp=${JSON.stringify(ramp)}`,
    );

    // A model at capacity for twelve hours is no longer waited for.
    await fail(await addRun(otherTaskId));
    await sql`
      UPDATE app.model_capacity_holds
      SET first_refused_at_ms = ${Date.now() - MODEL_CAPACITY_MAX_WAIT_MS - 1_000}
      WHERE org_id = ${orgId} AND model = ${model}
    `;
    const longRefused = await addRun(otherTaskId);
    await fail(longRefused);
    const ended = await sql<{ armed: boolean }[]>`
      SELECT auto_retry_armed_at_ms IS NOT NULL AS armed
      FROM app.project_agent_runs WHERE id = ${longRefused.runId}
    `;
    record(
      'model capacity: after twelve hours at capacity the refused run ends without a retry [TASK-R40]',
      ended[0] !== undefined && !ended[0].armed,
      `ended=${JSON.stringify(ended)}`,
    );
  } finally {
    await sql.begin(async (tx) => {
      const owned = await tx<{ id: string; name: string }[]>`
        SELECT j.id, j.name FROM pgboss.job j
        JOIN app.project_agent_runs r ON r.id = j.data ->> 'runId'
        WHERE r.project_id = ${projectId}
          AND j.name IN ('task.agent_turn', 'task.agent_park_wake')
          AND j.state IN ('created', 'retry')
      `;
      for (const queue of ['task.agent_turn', 'task.agent_park_wake']) {
        const ids = owned
          .filter((job) => job.name === queue)
          .map((job) => job.id);
        if (ids.length > 0) {
          await boss.cancel(queue, ids, { db: bossDbInTx(tx) });
        }
      }
      await tx`
        UPDATE app.project_agent_runs SET status = 'cancelled',
          settled_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
        WHERE project_id = ${projectId} AND status IN ('queued', 'running')
      `;
      await tx`
        DELETE FROM app.model_capacity_holds
        WHERE org_id = ${orgId} AND model = ${model}
      `;
      await tx`
        DELETE FROM app.model_capacity_recoveries
        WHERE org_id = ${orgId} AND model = ${model}
      `;
    });
  }
}
