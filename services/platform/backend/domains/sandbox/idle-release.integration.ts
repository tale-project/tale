/** Real Postgres owner/allocation guards; the runtime release itself is injected. */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { Sql } from 'postgres';

import type { TaskPayloads } from '../../jobs/tasks.ts';
import { lockOrgAdmission } from './admission-lock.ts';
import {
  releaseIdleSession,
  stopWorkflowSessionSlotsInTx,
} from './idle-release.ts';
import { releaseProjectAgentSessionSlot } from './sessions.ts';

export async function checkSandboxIdleRelease(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { userId } = ctx;
  // A release can wake its organization's oldest parked turn. This probe's
  // private org scope prevents that side effect from touching another lane.
  const orgId = `${ctx.orgId}:idle:${randomUUID()}`;
  const now = Date.now();
  const projectId = randomUUID();
  const agentId = randomUUID();
  const taskId = randomUUID();
  const projectRunId = randomUUID();
  const workflowRunId = randomUUID();
  const idleSessionId = `idle-${randomUUID()}`;
  const projectSessionId = `idle-${randomUUID()}`;
  const workflowSessionId = `idle-${randomUUID()}`;
  const workflowNodeSessionId = `idle-${randomUUID()}`;
  const sessionIds = [
    idleSessionId,
    projectSessionId,
    workflowSessionId,
    workflowNodeSessionId,
  ];
  const released: Array<{ sessionId: string; generation: string }> = [];
  const release = async (sessionId: string, generation: string) => {
    released.push({ sessionId, generation });
    return true;
  };
  const sessionState = async (sessionId: string) => {
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM app.sandbox_sessions
      WHERE org_id = ${orgId} AND session_id = ${sessionId}
    `;
    return rows[0]?.status;
  };
  const releaseJobs = async (sessionId: string) =>
    sql<{ id: string; data: TaskPayloads['sandbox.release_idle'] }[]>`
      SELECT id, data FROM pgboss.job
      WHERE name = 'sandbox.release_idle'
        AND data ->> 'organizationId' = ${orgId}
        AND data ->> 'sessionId' = ${sessionId}
      ORDER BY created_on, id
    `;
  const check = async (
    label: string,
    sessionId: string,
    shouldRelease: boolean,
    organizationId = orgId,
  ) => {
    const before = released.length;
    const generation = randomUUID();
    await releaseIdleSession(
      sql,
      { organizationId, sessionId, generation },
      release,
    );
    const call = released[before];
    const ok = shouldRelease
      ? released.length === before + 1 &&
        call?.sessionId === sessionId &&
        call.generation === generation
      : released.length === before;
    record(
      `sandbox idle release: ${label}`,
      ok,
      `runtime calls=${released.length - before} (want ${shouldRelease ? 1 : 0}), matching generation=${call?.generation === generation}`,
    );
  };
  const insertSession = async (
    sessionId: string,
    ownerType: string,
    ownerId: string,
  ) => {
    await sql`
      INSERT INTO app.sandbox_sessions (
        org_id, session_id, status, owner_type, owner_id, created_by,
        created_at_ms, expires_at_ms
      ) VALUES (
        ${orgId}, ${sessionId}, 'stopped', ${ownerType}, ${ownerId}, ${userId},
        ${now}, ${now + 3_600_000}
      )
    `;
  };

  try {
    await insertSession(idleSessionId, 'render', randomUUID());
    await check(
      'stopped unpinned allocation permits matching ticket',
      idleSessionId,
      true,
    );
    await check(
      'another organization cannot release the allocation',
      idleSessionId,
      false,
      `other-${randomUUID()}`,
    );
    await sql`UPDATE app.sandbox_sessions SET status = 'active' WHERE session_id = ${idleSessionId}`;
    await check('active allocation retains compute', idleSessionId, false);
    await sql`UPDATE app.sandbox_sessions SET status = 'stopped', pinned = true WHERE session_id = ${idleSessionId}`;
    await check('pinned allocation retains compute', idleSessionId, false);
    await sql`UPDATE app.sandbox_sessions SET pinned = false WHERE session_id = ${idleSessionId}`;
    const execId = randomUUID();
    await sql`
      INSERT INTO app.sandbox_session_ops (org_id, session_id, exec_id, kind, status, started_at_ms)
      VALUES (${orgId}, ${idleSessionId}, ${execId}, 'task-agent', 'running', ${now})
    `;
    await check(
      'running operation retains compute after allocation release',
      idleSessionId,
      false,
    );
    await sql`UPDATE app.sandbox_session_ops SET status = 'completed', finished_at_ms = ${now} WHERE session_id = ${idleSessionId} AND exec_id = ${execId}`;
    await check('finished operation permits idle release', idleSessionId, true);

    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
      VALUES (${projectId}, ${orgId}, 'Idle release proof', ${userId}, ${now}, ${now})
    `;
    await sql`
      INSERT INTO app.project_agents (id, org_id, project_id, name, harness, model, created_by, created_at_ms, updated_at_ms)
      VALUES (${agentId}, ${orgId}, ${projectId}, 'Idle release agent', 'opencode', 'itest', ${userId}, ${now}, ${now})
    `;
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank, created_by, created_by_type, created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${orgId}, ${projectId}, 'Idle release proof', 'in_progress', 'a0', ${userId}, 'user', ${now}, ${now})
    `;
    await insertSession(projectSessionId, 'project_agent', agentId);
    // The new turn has no op yet and can reference a different incarnation;
    // the owner guard must still protect this agent's standing workspace.
    await sql`
      INSERT INTO app.project_agent_runs (
        id, org_id, project_id, task_id, agent_id, session_id, exec_id, status,
        harness, model, started_by, started_at_ms, deadline_at_ms, updated_at_ms
      ) VALUES (
        ${projectRunId}, ${orgId}, ${projectId}, ${taskId}, ${agentId},
        ${`pending-${randomUUID()}`}, ${randomUUID()}, 'queued', 'opencode',
        'itest', ${userId}, ${now}, ${now + 3_600_000}, ${now}
      )
    `;
    await check(
      'queued project owner protects the pre-exec gap',
      projectSessionId,
      false,
    );
    await sql`UPDATE app.project_agent_runs SET status = 'running' WHERE id = ${projectRunId}`;
    await check(
      'running project owner protects the pre-exec gap',
      projectSessionId,
      false,
    );
    await sql`UPDATE app.project_agent_runs SET status = 'queued', waiting_for_capacity_at_ms = ${now} WHERE id = ${projectRunId}`;
    await check(
      'capacity-parked project owner holds no compute',
      projectSessionId,
      true,
    );
    await sql`UPDATE app.project_agent_runs SET status = 'settled', waiting_for_capacity_at_ms = NULL WHERE id = ${projectRunId}`;
    await check(
      'settled project owner permits idle release',
      projectSessionId,
      true,
    );

    // An old settle starts while a newer turn is being admitted. The old
    // run is terminal in its pre-lock snapshot; only sharing the admission
    // lock makes release observe the new queued owner before its UPDATE.
    await sql`UPDATE app.sandbox_sessions SET status = 'active' WHERE session_id = ${projectSessionId}`;
    let openAdmission: () => void = () => undefined;
    const admissionMayCommit = new Promise<void>((resolve) => {
      openAdmission = resolve;
    });
    let admissionReady: (pid: number) => void = () => undefined;
    const admissionHeld = new Promise<number>((resolve) => {
      admissionReady = resolve;
    });
    const admitting = sql.begin(async (tx) => {
      await lockOrgAdmission(tx, orgId);
      await tx`UPDATE app.project_agent_runs SET status = 'queued' WHERE id = ${projectRunId}`;
      const pids = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      const pid = pids[0]?.pid;
      if (pid === undefined)
        throw new Error('Admission backend PID unavailable');
      admissionReady(pid);
      await admissionMayCommit;
    });
    const holderPid = await Promise.race([
      admissionHeld,
      admitting.then(() => 0),
    ]);
    const delayedRelease = releaseProjectAgentSessionSlot(
      sql,
      { organizationId: orgId, agentId },
      async () => null,
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    let queuedBehindAdmission = false;
    try {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const waiting = await sql<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks waiter JOIN pg_locks holder
              ON waiter.locktype = holder.locktype
              AND waiter.classid = holder.classid
              AND waiter.objid = holder.objid
              AND waiter.objsubid = holder.objsubid
            WHERE holder.pid = ${holderPid} AND holder.locktype = 'advisory'
              AND holder.granted AND NOT waiter.granted
          ) AS waiting
        `;
        if (waiting[0]?.waiting) {
          queuedBehindAdmission = true;
          break;
        }
        await delay(20);
      }
    } finally {
      openAdmission();
      await admitting;
    }
    const olderRelease = await delayedRelease;
    const admittedStatus = await sessionState(projectSessionId);
    record(
      'sandbox idle release: older project settle waits for admission and preserves its pre-exec slot',
      queuedBehindAdmission &&
        'value' in olderRelease &&
        !olderRelease.value &&
        admittedStatus === 'active',
      `waited=${queuedBehindAdmission}, released=${'value' in olderRelease ? olderRelease.value : String(olderRelease.error)}, status=${admittedStatus}`,
    );
    await sql`UPDATE app.project_agent_runs SET status = 'failed' WHERE id = ${projectRunId}`;
    const failedOwnerReleased = await releaseProjectAgentSessionSlot(
      sql,
      { organizationId: orgId, agentId },
      async () => null,
    );
    const failedOwnerStatus = await sessionState(projectSessionId);
    record(
      'sandbox idle release: failed new project owner permits allocation release',
      failedOwnerReleased && failedOwnerStatus === 'stopped',
      `released=${failedOwnerReleased}, status=${failedOwnerStatus}`,
    );

    await sql`
      INSERT INTO app.automation_runs (id, org_id, name, version, status, mode, started_by, input, checkpoints, started_at_ms)
      VALUES (${workflowRunId}, ${orgId}, 'Idle release workflow', 1, 'queued', 'mock', ${userId}, ${sql.json({})}, ${sql.json({})}, ${now})
    `;
    await insertSession(workflowSessionId, 'workflow_run', workflowRunId);
    await insertSession(
      workflowNodeSessionId,
      'workflow_run',
      `${workflowRunId}:agent`,
    );
    for (const status of [
      'queued',
      'running',
      'waiting',
      'success',
      'failed',
      'cancelled',
    ]) {
      await sql`UPDATE app.automation_runs SET status = ${status} WHERE id = ${workflowRunId}`;
      const terminal = ['success', 'failed', 'cancelled'].includes(status);
      await check(
        `${status} workflow owner ${terminal ? 'permits' : 'blocks'} release`,
        workflowSessionId,
        terminal,
      );
      await check(
        `${status} workflow node owner ${terminal ? 'permits' : 'blocks'} release`,
        workflowNodeSessionId,
        terminal,
      );
    }

    const firstGeneration = randomUUID();
    await sql`UPDATE app.automation_runs SET status = 'running' WHERE id = ${workflowRunId}`;
    await sql`UPDATE app.sandbox_sessions SET status = 'active' WHERE session_id IN (${workflowSessionId}, ${workflowNodeSessionId})`;
    await sql.begin((tx) =>
      stopWorkflowSessionSlotsInTx(
        tx,
        {
          organizationId: orgId,
          executionId: workflowRunId,
          onlyIdle: true,
        },
        async () => firstGeneration,
      ),
    );
    const betweenSteps = await sessionState(workflowSessionId);
    const betweenStepJobs = await releaseJobs(workflowSessionId);
    record(
      'sandbox idle release: workflow keeps its slot between steps before the next op exists',
      betweenSteps === 'active' && betweenStepJobs.length === 0,
      `status=${betweenSteps}, jobs=${betweenStepJobs.length}`,
    );
    const workflowExecId = randomUUID();
    await sql`
      INSERT INTO app.sandbox_session_ops (org_id, session_id, exec_id, kind, status, started_at_ms)
      VALUES (${orgId}, ${workflowSessionId}, ${workflowExecId}, 'workflow-agent', 'running', ${now})
    `;

    const rollback = new Error('idle-release intentional rollback');
    let queuedInsideTransaction = false;
    let hiddenUntilCommit = false;
    await sql
      .begin(async (tx) => {
        await tx`UPDATE app.automation_runs SET status = 'cancelled' WHERE id = ${workflowRunId}`;
        await stopWorkflowSessionSlotsInTx(
          tx,
          { organizationId: orgId, executionId: workflowRunId },
          async () => firstGeneration,
        );
        const queued = await tx<{ count: string }[]>`
        SELECT count(*)::text AS count FROM pgboss.job
        WHERE name = 'sandbox.release_idle'
          AND data ->> 'organizationId' = ${orgId}
          AND data ->> 'sessionId' = ${workflowSessionId}
      `;
        queuedInsideTransaction = queued[0]?.count === '1';
        hiddenUntilCommit = (await releaseJobs(workflowSessionId)).length === 0;
        throw rollback;
      })
      .catch((error: unknown) => {
        if (error !== rollback) throw error;
      });
    const rolledBackState = await sessionState(workflowSessionId);
    const rolledBackJobs = await releaseJobs(workflowSessionId);
    record(
      'sandbox idle release: rolled-back cancellation exposes neither its stopped slot nor release job',
      queuedInsideTransaction &&
        hiddenUntilCommit &&
        rolledBackState === 'active' &&
        rolledBackJobs.length === 0,
      `queuedInTx=${queuedInsideTransaction}, hidden=${hiddenUntilCommit}, status=${rolledBackState}, jobs=${rolledBackJobs.length}`,
    );

    await sql.begin(async (tx) => {
      await tx`UPDATE app.automation_runs SET status = 'cancelled' WHERE id = ${workflowRunId}`;
      await stopWorkflowSessionSlotsInTx(
        tx,
        { organizationId: orgId, executionId: workflowRunId },
        async () => firstGeneration,
      );
    });
    const firstJobs = await releaseJobs(workflowSessionId);
    const firstJob = firstJobs.find(
      (job) => job.data.generation === firstGeneration,
    );
    const beforeFirstDelivery = released.length;
    if (firstJob) await releaseIdleSession(sql, firstJob.data, release);
    const cancelledState = await sessionState(workflowSessionId);
    record(
      'sandbox idle release: committed cancellation frees quota but its first job cannot release a running op',
      firstJobs.length === 1 &&
        firstJob !== undefined &&
        cancelledState === 'stopped' &&
        released.length === beforeFirstDelivery,
      `status=${cancelledState}, jobs=${firstJobs.length}, runtimeCalls=${released.length - beforeFirstDelivery}`,
    );
    if (firstJob)
      await sql`UPDATE pgboss.job SET state = 'completed', completed_on = now() WHERE id = ${firstJob.id}`;
    const secondGeneration = randomUUID();
    await sql.begin(async (tx) => {
      await tx`UPDATE app.sandbox_session_ops SET status = 'cancelled', finished_at_ms = ${Date.now()} WHERE session_id = ${workflowSessionId} AND exec_id = ${workflowExecId}`;
      await stopWorkflowSessionSlotsInTx(
        tx,
        { organizationId: orgId, executionId: workflowRunId, onlyIdle: true },
        async () => secondGeneration,
      );
    });
    const finalJobs = await releaseJobs(workflowSessionId);
    const finalJob = finalJobs.find(
      (job) => job.data.generation === secondGeneration,
    );
    const beforeFinalDelivery = released.length;
    if (finalJob) await releaseIdleSession(sql, finalJob.data, release);
    const runtimeRelease = released[beforeFinalDelivery];
    record(
      'sandbox idle release: finishing the op on an already-stopped workflow queues a fresh releasable job',
      finalJobs.length === 2 &&
        finalJob !== undefined &&
        released.length === beforeFinalDelivery + 1 &&
        runtimeRelease?.generation === secondGeneration &&
        runtimeRelease.sessionId === workflowSessionId,
      `jobs=${finalJobs.length}, runtimeCalls=${released.length - beforeFinalDelivery}, matchingGeneration=${runtimeRelease?.generation === secondGeneration}`,
    );
  } finally {
    // Only this probe's UUID fixtures are removed; no shared state is reset.
    await sql`DELETE FROM pgboss.job WHERE name = 'sandbox.release_idle' AND data ->> 'organizationId' = ${orgId} AND data ->> 'sessionId' = ANY(${sessionIds})`;
    await sql`DELETE FROM app.sandbox_session_ops WHERE session_id = ANY(${sessionIds})`;
    await sql`DELETE FROM app.sandbox_sessions WHERE session_id = ANY(${sessionIds})`;
    await sql`DELETE FROM app.automation_runs WHERE id = ${workflowRunId}`;
    await sql`DELETE FROM app.project_agent_runs WHERE id = ${projectRunId}`;
    await sql`DELETE FROM app.tasks WHERE id = ${taskId}`;
    await sql`DELETE FROM app.project_agents WHERE id = ${agentId}`;
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
  }
}
