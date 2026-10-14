/**
 * Real PostgreSQL proof of a project agent run's heavy-phase leases, with a
 * stand-in for the sandbox host: a live run's lease is recorded for it on its
 * own session; asking again while it holds one answers that lease; another
 * run's lease is not found and stays held; a token whose run has ended takes
 * none; the readback names the run that holds each lease; a cancel queues
 * the release of every lease the run holds in its own transaction, with the
 * leases it read; the release ends each on the host once, and a second
 * delivery asks nothing; the sweep ends the lease of a run whose release job
 * never ran, and stops counting a lease past its expiry. Every job the lane's
 * runs enqueue is held a day ahead (`holdAgentJobs`), so no worker launches a
 * fixture or asks the real host.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import type {
  SandboxHeavyLease,
  SandboxLeaseRequest,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { cancelAgentRunInTx, settleAgentRun } from '../tasks/agent-runs.ts';
import { holdAgentJobs } from '../tasks/delegated-start.integration.ts';
import {
  acquireRunHeavyLease,
  readActiveHeavyLeases,
  releaseEndedRunLeases,
  releaseRunHeavyLease,
  sweepHeavyLeases,
  type LeaseSpawner,
} from './heavy-leases.ts';

/** A sandbox host that grants every lease and remembers what it holds. */
function standInHost(): LeaseSpawner & {
  acquired: string[];
  released: string[];
} {
  const held = new Map<string, SandboxHeavyLease>();
  const acquired: string[] = [];
  const released: string[] = [];
  return {
    acquired,
    released,
    acquire: async (sessionId: string, request: SandboxLeaseRequest) => {
      const now = Date.now();
      const lease: SandboxHeavyLease = {
        id: randomUUID(),
        sessionId,
        organizationId: request.organizationId,
        class: 'heavy',
        label: request.label ?? null,
        predictedGrowthBytes: request.predictedGrowthBytes ?? 2 * 1024 ** 3,
        memoryBytes: request.memoryBytes ?? 1024 ** 3,
        acquiredAtMs: now,
        expiresAtMs: now + (request.ttlMs ?? 30 * 60_000),
      };
      held.set(lease.id, lease);
      acquired.push(lease.id);
      return { granted: true, lease };
    },
    release: async ({ leaseId }) => {
      released.push(leaseId);
      return held.delete(leaseId) ? 'released' : 'gone';
    },
    list: async (organizationId) =>
      [...held.values()].filter(
        (lease) => lease.organizationId === organizationId,
      ),
  };
}

export async function checkHeavyPhaseLeases(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const projectId = randomUUID();
  const agentId = randomUUID();
  const otherAgentId = randomUUID();
  const now = Date.now();
  const release = await holdAgentJobs(sql, `leases_${suffix}`, [projectId], {
    extraQueues: [
      'task.agent_drive',
      'sandbox.release_run_leases',
      'tasks.dispatch_project',
    ],
  });
  const host = standInHost();
  try {
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
      VALUES (${projectId}, ${orgId}, 'Heavy-phase leases', ${userId}, ${now}, ${now})
    `;
    for (const [id, name] of [
      [agentId, 'Builder'],
      [otherAgentId, 'Tester'],
    ] as const) {
      await sql`
        INSERT INTO app.project_agents (id, org_id, project_id, name, harness,
          model, created_by, created_at_ms, updated_at_ms)
        VALUES (${id}, ${orgId}, ${projectId}, ${name}, 'codex',
          'itest-leases', ${userId}, ${now}, ${now})
      `;
    }
    /** A running task run of an agent, in a project agent's session of its
     * own. */
    const addRun = async (agent: string, title: string) => {
      const taskId = randomUUID();
      const execId = randomUUID();
      const sessionId = `pa-${agent}-${randomUUID().slice(0, 6)}`;
      const at = Date.now();
      await sql`
        INSERT INTO app.tasks (id, org_id, project_id, title, status,
          assignee_type, assignee_id, rank, created_by, created_by_type,
          created_at_ms, updated_at_ms)
        VALUES (${taskId}, ${orgId}, ${projectId}, ${title}, 'todo',
          'agent', ${agent}, 'a0', ${userId}, 'user', ${at}, ${at})
      `;
      await sql`
        INSERT INTO app.sandbox_sessions (org_id, session_id, status,
          owner_type, owner_id, created_by, created_at_ms, expires_at_ms)
        VALUES (${orgId}, ${sessionId}, 'active', 'project_agent', ${agent},
          ${userId}, ${at}, ${at + 3_600_000})
      `;
      const rows = await sql<{ id: string }[]>`
        INSERT INTO app.project_agent_runs (
          org_id, project_id, task_id, agent_id, exec_id, session_id, status,
          harness, model, started_by, trigger, started_at_ms, launched_at_ms,
          deadline_at_ms, updated_at_ms
        ) VALUES (
          ${orgId}, ${projectId}, ${taskId}, ${agent}, ${execId}, ${sessionId},
          'running', 'codex', 'itest-leases', ${userId}, 'manual',
          ${at - 2_000}, ${at - 1_000}, ${at + 3_600_000}, ${at}
        ) RETURNING id
      `;
      const runId = rows[0]?.id;
      if (runId === undefined) throw new Error('itest: lease run missing');
      return {
        runId,
        taskId,
        token: { organizationId: orgId, sessionId, taskRunExecId: execId },
      };
    };
    const rowsOf = (runId: string) =>
      sql<
        {
          leaseId: string;
          sessionId: string;
          execId: string;
          releasedAt: number | null;
          reason: string | null;
        }[]
      >`
        SELECT lease_id AS "leaseId", session_id AS "sessionId",
               exec_id AS "execId", released_at_ms::float8 AS "releasedAt",
               release_reason AS reason
        FROM app.sandbox_heavy_leases
        WHERE org_id = ${orgId} AND run_id = ${runId}
        ORDER BY acquired_at_ms
      `;

    const ada = await addRun(agentId, 'Install the dependencies');
    const noah = await addRun(otherAgentId, 'Run the full test suite');

    const granted = await acquireRunHeavyLease(
      sql,
      { ...ada.token, label: 'npm ci', ttlMs: 600_000 },
      host,
    );
    const adaRows = await rowsOf(ada.runId);
    const adaLease = adaRows[0];
    record(
      'heavy leases: a live run’s lease is recorded for it on its own session [SBX-R28]',
      granted.outcome === 'granted' &&
        adaRows.length === 1 &&
        adaLease?.leaseId === granted.lease.leaseId &&
        adaLease.sessionId === ada.token.sessionId &&
        adaLease.execId === ada.token.taskRunExecId &&
        adaLease.releasedAt === null,
      `granted=${JSON.stringify(granted)} rows=${JSON.stringify(adaRows)}`,
    );
    if (adaLease === undefined) throw new Error('itest: no lease recorded');

    const again = await acquireRunHeavyLease(
      sql,
      { ...ada.token, label: 'docker build' },
      host,
    );
    record(
      'heavy leases: a run that holds a lease is answered that lease, not a second one [SBX-R28]',
      again.outcome === 'already_held' &&
        again.lease.leaseId === adaLease.leaseId &&
        host.acquired.length === 1,
      `again=${JSON.stringify(again)} acquired=${host.acquired.length}`,
    );

    const noahGranted = await acquireRunHeavyLease(
      sql,
      { ...noah.token, label: 'bun test' },
      host,
    );
    const noahLeaseId =
      noahGranted.outcome === 'granted' ? noahGranted.lease.leaseId : '';
    const crossed = await releaseRunHeavyLease(
      sql,
      { ...ada.token, leaseId: noahLeaseId },
      host,
    );
    const ended = await acquireRunHeavyLease(
      sql,
      { ...ada.token, taskRunExecId: 'an-ended-exec', label: 'npm ci' },
      host,
    );
    const noahRows = await rowsOf(noah.runId);
    record(
      'heavy leases: another run’s lease is not found and stays held; an ended token takes none [SBX-R31]',
      noahGranted.outcome === 'granted' &&
        crossed.outcome === 'not_found' &&
        !host.released.includes(noahLeaseId) &&
        noahRows[0]?.releasedAt === null &&
        ended.outcome === 'run_ended',
      `noah=${JSON.stringify(noahGranted)} crossed=${JSON.stringify(crossed)} ended=${JSON.stringify(ended)} rows=${JSON.stringify(noahRows)}`,
    );

    const readback = await readActiveHeavyLeases(sql, orgId, host);
    const listed =
      readback.status === 'available'
        ? readback.leases.find((lease) => lease.leaseId === adaLease.leaseId)
        : undefined;
    record(
      'heavy leases: the readback names the run, task and agent of each lease [SBX-R33]',
      listed?.run?.runId === ada.runId &&
        listed.run.taskId === ada.taskId &&
        listed.run.agentName === 'Builder' &&
        listed.run.projectId === projectId,
      `readback=${JSON.stringify(readback)}`,
    );

    await sql.begin((tx) =>
      cancelAgentRunInTx(tx, {
        organizationId: orgId,
        runId: ada.runId,
        taskId: ada.taskId,
      }),
    );
    const jobs = await sql<{ data: { leases?: unknown } }[]>`
      SELECT data FROM pgboss.job
      WHERE name = 'sandbox.release_run_leases'
        AND data ->> 'runId' = ${ada.runId}
    `;
    record(
      'heavy leases: a cancel queues the release of the run’s leases in its own transaction [SBX-R32]',
      jobs.length === 1 &&
        JSON.stringify(jobs[0]?.data.leases) ===
          JSON.stringify([
            { leaseId: adaLease.leaseId, sessionId: ada.token.sessionId },
          ]),
      `jobs=${JSON.stringify(jobs)}`,
    );

    const payload = {
      organizationId: orgId,
      runId: ada.runId,
      leases: [{ leaseId: adaLease.leaseId, sessionId: ada.token.sessionId }],
    };
    const first = await releaseEndedRunLeases(sql, payload, host);
    const releasedOnce = host.released.filter(
      (id) => id === adaLease.leaseId,
    ).length;
    const second = await releaseEndedRunLeases(sql, payload, host);
    const afterRelease = await rowsOf(ada.runId);
    record(
      'heavy leases: the release ends each lease of the ended run once, and a second delivery asks nothing [SBX-R32]',
      first.ended === 1 &&
        second.ended === 0 &&
        releasedOnce === 1 &&
        host.released.filter((id) => id === adaLease.leaseId).length === 1 &&
        afterRelease[0]?.reason === 'run_ended' &&
        afterRelease[0].releasedAt !== null,
      `first=${JSON.stringify(first)} second=${JSON.stringify(second)} rows=${JSON.stringify(afterRelease)}`,
    );

    // Noah's run settles, and its release job never runs: the sweep, ten
    // minutes on, ends the lease. A third run's lease, past its expiry,
    // stops counting.
    await settleAgentRun(sql, { runId: noah.runId, resultText: 'done' });
    const late = await addRun(otherAgentId, 'Build the image');
    const lateGranted = await acquireRunHeavyLease(
      sql,
      { ...late.token, label: 'docker build' },
      host,
    );
    await sql`
      UPDATE app.sandbox_heavy_leases SET expires_at_ms = ${Date.now() - 1_000}
      WHERE org_id = ${orgId} AND run_id = ${late.runId}
    `;
    const swept = await sweepHeavyLeases(sql, {
      now: Date.now() + 10 * 60_000,
      spawner: host,
    });
    const noahAfter = await rowsOf(noah.runId);
    const lateAfter = await rowsOf(late.runId);
    record(
      'heavy leases: the sweep ends the lease of a run its job missed, and stops counting an expired one [SBX-R32]',
      lateGranted.outcome === 'granted' &&
        swept.released >= 1 &&
        swept.expired >= 1 &&
        noahAfter[0]?.reason === 'run_ended' &&
        host.released.includes(noahLeaseId) &&
        lateAfter[0]?.reason === 'expired',
      `swept=${JSON.stringify(swept)} noah=${JSON.stringify(noahAfter)} late=${JSON.stringify(lateAfter)}`,
    );
  } finally {
    await sql`
      UPDATE app.project_agent_runs SET status = 'cancelled',
        settled_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
      WHERE project_id = ${projectId} AND status IN ('queued', 'running')
    `;
    await sql`
      DELETE FROM app.sandbox_heavy_leases
      WHERE org_id = ${orgId} AND run_id IN (
        SELECT id FROM app.project_agent_runs WHERE project_id = ${projectId}
      )
    `;
    await sql`
      DELETE FROM app.sandbox_sessions
      WHERE org_id = ${orgId} AND owner_type = 'project_agent'
        AND owner_id IN (${agentId}, ${otherAgentId})
    `;
    await release();
  }
}
