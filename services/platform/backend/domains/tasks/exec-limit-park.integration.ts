/** Real Postgres proof that a run whose exec its workspace's runtime refused
 * for want of a live-exec place (`EXEC_LIMIT`: four turns already run in the
 * agent's workspace) waits for room through the capacity park instead of
 * failing (#3977, TALE-386 step 2):
 *
 * - the host's park of the launched run takes it back to `queued`, parked,
 *   with no launch stamp and on a fresh exec: no failure, no retry armed, no
 *   attempt spent, and the workspace stays up for the four;
 * - one of the four ending wakes the oldest run parked on that workspace,
 *   once, and leaves a run parked on another workspace alone; the next end
 *   wakes the next;
 * - the woken run launches only on its fresh exec, and its launch stamp is
 *   that launch's, so the wait never counts as executed time.
 *
 * The host's own decision — an `EXEC_LIMIT` start window parks, any other
 * refusal still fails — is the unit test's (`agent_run_host.context_window
 * .test.ts`); this lane drives the same shim handlers the host calls, on
 * hand-inserted rows. The agent is a PHANTOM id with no `project_agents`
 * row: every wake enqueues the run's real `task.agent_turn` job, and the
 * live worker's turn job skips a run whose agent is gone before it touches
 * the run. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { agentTurnShimHandlers } from './agent-turn-shim.ts';

interface RunState {
  status: string;
  execId: string;
  parked: boolean;
  launchedAt: number | null;
  error: string | null;
  failureCode: string | null;
  autoRetryAttempt: number | null;
}

export async function checkExecLimitPark(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const shim = agentTurnShimHandlers(sql);
  const park = shim['tasks/agent_runs:parkTaskAgentRunForCapacity'];
  const settle = shim['tasks/agent_runs:markTaskAgentRunSettled'];
  const release =
    shim['sandbox/session_mutations:releaseProjectAgentSessionSlot'];
  const launch = shim['tasks/agent_runs:setTaskAgentRunRunning'];
  if (!park || !settle || !release || !launch) {
    throw new Error(
      'the task-agent shim lacks a park, settle, release or launch',
    );
  }

  const now = Date.now();
  const projectId = randomUUID();
  const agentId = `itest-exec-limit-agent-${randomUUID()}`;
  const sessionId = `pa-${agentId}`;
  const memberSessionId = `pm-${agentId}-${userId}`;
  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
    VALUES (${projectId}, ${orgId}, 'Exec places', ${userId}, ${now}, ${now})
  `;
  await sql`
    INSERT INTO app.sandbox_sessions (
      org_id, session_id, status, owner_type, owner_id, created_by,
      created_at_ms, expires_at_ms
    ) VALUES (
      ${orgId}, ${sessionId}, 'active', 'project_agent', ${agentId},
      'itest:exec-limit', ${now}, ${now + 3_600_000}
    )
  `;

  /** One task and its run; a running run holds a running op of its exec, as
   * the host's launch leaves it. */
  const addRun = async (args: {
    execId: string;
    status: 'queued' | 'running';
    session: string;
    launchedAt?: number;
    parkedAt?: number;
    autoRetryAttempt?: number;
  }): Promise<string> => {
    const taskId = randomUUID();
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status,
        assignee_type, assignee_id, rank, created_by, created_by_type,
        created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${orgId}, ${projectId}, ${`Exec place ${args.execId}`},
        'in_progress', 'agent', ${agentId}, 'a0', ${userId}, 'user', ${now},
        ${now})
    `;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, trigger, auto_retry_attempt, started_by,
        started_at_ms, launched_at_ms, waiting_for_capacity_at_ms,
        deadline_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${taskId}, ${agentId}, ${args.execId},
        ${args.session}, ${args.status}, 'claude-code', 'itest-model',
        ${args.autoRetryAttempt !== undefined ? 'auto_retry' : 'manual'},
        ${args.autoRetryAttempt ?? null}, 'itest:exec-limit',
        ${now - 30 * 60_000}, ${args.launchedAt ?? null},
        ${args.parkedAt ?? null}, ${now + 3_600_000}, ${now}
      ) RETURNING id
    `;
    if (args.status === 'running') {
      await sql`
        INSERT INTO app.sandbox_session_ops (
          org_id, session_id, exec_id, kind, status, heartbeat_at_ms,
          started_at_ms
        ) VALUES (
          ${orgId}, ${args.session}, ${args.execId}, 'task-agent', 'running',
          ${now}, ${now}
        )
      `;
    }
    return rows[0]?.id ?? '';
  };
  const state = async (runId: string): Promise<RunState | undefined> =>
    (
      await sql<RunState[]>`
        SELECT status, exec_id AS "execId",
               waiting_for_capacity_at_ms IS NOT NULL AS parked,
               launched_at_ms::float8 AS "launchedAt", error,
               failure_code AS "failureCode",
               auto_retry_attempt AS "autoRetryAttempt"
        FROM app.project_agent_runs WHERE id = ${runId}
      `
    )[0];
  const turnJobs = async (runId: string): Promise<string[]> =>
    (
      await sql<{ execId: string }[]>`
        SELECT data ->> 'execId' AS "execId" FROM pgboss.job
        WHERE name = 'task.agent_turn' AND data ->> 'runId' = ${runId}
      `
    ).map((job) => job.execId);
  const retryJobs = async (runId: string): Promise<number> =>
    Number(
      (
        await sql<{ count: string }[]>`
          SELECT count(*)::text AS count FROM pgboss.job
          WHERE name = 'task.agent_retry'
            AND data ->> 'expectedRunId' = ${runId}
        `
      )[0]?.count ?? '0',
    );
  const sessionStatus = async (): Promise<string | undefined> =>
    (
      await sql<{ status: string }[]>`
        SELECT status FROM app.sandbox_sessions
        WHERE org_id = ${orgId} AND session_id = ${sessionId}
      `
    )[0]?.status;
  /** A turn of the four ends the way the host ends it: the settle mark, its
   * op closed, then the release naming the run's workspace. */
  const endTurn = async (runId: string, execId: string): Promise<void> => {
    await settle({ runId, execId, resultText: 'done' });
    await sql`
      UPDATE app.sandbox_session_ops SET
        status = 'completed', finished_at_ms = ${Date.now()},
        finalized_at_ms = ${Date.now()}
      WHERE session_id = ${sessionId} AND exec_id = ${execId}
    `;
    await release({ organizationId: orgId, agentId, sessionId });
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  try {
    // Four turns hold every live-exec place of the agent's workspace. A run
    // parked on the agent's member workspace, longer than anyone, is the
    // control: no turn of the standing workspace frees its room.
    const holders: Array<{ runId: string; execId: string }> = [];
    for (let n = 1; n <= 4; n += 1) {
      const execId = `exec-limit-holder-${n}-${randomUUID()}`;
      holders.push({
        runId: await addRun({
          execId,
          status: 'running',
          session: sessionId,
          launchedAt: now - 60_000,
        }),
        execId,
      });
    }
    const elsewhereId = await addRun({
      execId: `exec-limit-elsewhere-${randomUUID()}`,
      status: 'queued',
      session: memberSessionId,
      parkedAt: now - 10 * 60_000,
    });

    // The fifth run, a retry showing attempt 2, launched twenty minutes ago
    // by the clock of its launch stamp; the runtime refused its exec, and the
    // host parks it.
    const fifthExec = `exec-limit-fifth-${randomUUID()}`;
    const fifthId = await addRun({
      execId: fifthExec,
      status: 'running',
      session: sessionId,
      launchedAt: now - 20 * 60_000,
      autoRetryAttempt: 2,
    });
    await park({ runId: fifthId, execId: fifthExec, execRefused: true });
    const fifth = await state(fifthId);
    const fifthRetries = await retryJobs(fifthId);
    const fifthTurns = await turnJobs(fifthId);
    const afterPark = await sessionStatus();
    record(
      'a run whose exec found every live-exec place taken waits parked — queued, off its launch, on a fresh exec — instead of failing',
      fifth?.status === 'queued' &&
        fifth.parked &&
        fifth.launchedAt === null &&
        fifth.execId !== fifthExec &&
        fifth.error === null &&
        fifth.failureCode === null &&
        fifth.autoRetryAttempt === 2 &&
        fifthRetries === 0 &&
        fifthTurns.length === 0 &&
        afterPark === 'active',
      `run=${JSON.stringify(fifth)} (want queued, parked, launchedAt null, a new exec, no error/code, attempt 2) retryJobs=${fifthRetries}/0 turnJobs=${fifthTurns.length}/0 session=${afterPark ?? 'MISSING'}/active`,
    );

    // A second refused run, parked after the fifth.
    await tick();
    const sixthExec = `exec-limit-sixth-${randomUUID()}`;
    const sixthId = await addRun({
      execId: sixthExec,
      status: 'running',
      session: sessionId,
      launchedAt: now - 1_000,
    });
    await park({ runId: sixthId, execId: sixthExec, execRefused: true });

    // One of the four ends: the place it gave back goes to the oldest run
    // parked on the workspace, and to nobody else.
    const [first, second] = holders;
    if (!first || !second) throw new Error('the four holders were not seeded');
    const beforeEnd = await state(fifthId);
    const wokenAtMs = Date.now();
    await endTurn(first.runId, first.execId);
    const fifthWoken = await state(fifthId);
    const fifthWokenTurns = await turnJobs(fifthId);
    const sixthAfterFirst = await state(sixthId);
    const elsewhereAfterFirst = await state(elsewhereId);
    const afterFirstEnd = await sessionStatus();
    record(
      'one of the four ending wakes the oldest run parked on its workspace once, and no run parked elsewhere',
      (beforeEnd?.parked ?? false) &&
        fifthWoken?.status === 'queued' &&
        !fifthWoken.parked &&
        fifthWokenTurns.length === 1 &&
        fifthWokenTurns[0] === fifthWoken.execId &&
        (sixthAfterFirst?.parked ?? false) &&
        (elsewhereAfterFirst?.parked ?? false) &&
        afterFirstEnd === 'active',
      `fifth parked ${String(beforeEnd?.parked)}→${String(fifthWoken?.parked)} (want true→false) turnJobs=${JSON.stringify(fifthWokenTurns)} (want [its exec ${fifthWoken?.execId ?? '?'}]) sixth parked=${String(sixthAfterFirst?.parked)}/true elsewhere parked=${String(elsewhereAfterFirst?.parked)}/true session=${afterFirstEnd ?? 'MISSING'}/active`,
    );

    // The next end wakes the next run parked there; the first stays woken
    // once.
    await endTurn(second.runId, second.execId);
    const sixthWoken = await state(sixthId);
    const fifthTurnsAfterSecond = await turnJobs(fifthId);
    const sixthTurns = await turnJobs(sixthId);
    const elsewhereAfterSecond = await state(elsewhereId);
    record(
      'the next turn ending wakes the next run parked on the workspace, first come first served',
      sixthWoken?.status === 'queued' &&
        !sixthWoken.parked &&
        sixthTurns.length === 1 &&
        fifthTurnsAfterSecond.length === 1 &&
        (elsewhereAfterSecond?.parked ?? false),
      `sixth parked=${String(sixthWoken?.parked)}/false turnJobs=${sixthTurns.length}/1 fifth turnJobs=${fifthTurnsAfterSecond.length}/1 elsewhere parked=${String(elsewhereAfterSecond?.parked)}/true`,
    );

    // The woken run launches on its fresh exec only, and its launch stamp is
    // this launch's: the twenty minutes of the refused launch and the wait
    // never pass for executed time.
    const staleLaunch = await launch({ runId: fifthId, execId: fifthExec });
    const freshLaunch = await launch({
      runId: fifthId,
      execId: fifthWoken?.execId ?? '',
    });
    const relaunched = await state(fifthId);
    record(
      'the woken run launches only on its fresh exec, stamped by that launch',
      staleLaunch === false &&
        freshLaunch === true &&
        relaunched?.status === 'running' &&
        (relaunched.launchedAt ?? 0) >= wokenAtMs,
      `stale=${String(staleLaunch)}/false fresh=${String(freshLaunch)}/true status=${relaunched?.status ?? 'MISSING'}/running launchedAt=${relaunched?.launchedAt ?? 'null'} (want >= ${wokenAtMs})`,
    );
  } finally {
    // Nothing of the lane stays live or parked: later lanes count parked
    // runs and running ops organization-wide.
    await sql`
      UPDATE app.project_agent_runs SET status = 'cancelled',
        waiting_for_capacity_at_ms = NULL, settled_at_ms = ${Date.now()},
        updated_at_ms = ${Date.now()}
      WHERE org_id = ${orgId} AND agent_id = ${agentId}
        AND status IN ('queued', 'running')
    `;
    await sql`
      UPDATE app.sandbox_session_ops SET
        status = 'cancelled', finished_at_ms = ${Date.now()},
        finalized_at_ms = coalesce(finalized_at_ms, ${Date.now()})
      WHERE org_id = ${orgId} AND session_id = ${sessionId}
        AND status = 'running'
    `;
    await sql`
      UPDATE app.sandbox_sessions SET status = 'stopped'
      WHERE org_id = ${orgId} AND session_id = ${sessionId}
    `;
  }
}
