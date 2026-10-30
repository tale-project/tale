/** Real Postgres proof that a run which keeps running out of memory is
 * retried three times, then stops (#5148, `TASK-R84`). Every attempt works
 * twenty minutes before its sandbox's memory limit ends it — past the 15
 * minutes after which any other failure starts the count again — so only
 * the out-of-memory rule can end the chain:
 *
 * - each failure's real mark (`failAgentRunFromTurn`) holds its retry
 *   decision 2, then 10, then 30 minutes, the card reads the run as about to
 *   be retried meanwhile, and the real retry worker starts attempts 1, 2 and
 *   3 for the person who started the first run, telling nobody;
 * - the task's hourly breaker counts each of those retries, never the
 *   person's own start (`TASK-R12`): its window is spent after the third;
 * - when the third retry runs out of memory too, the run fails for good at
 *   once: no retry is held, the card reads the failure as final, out of
 *   memory, and the starter is told once.
 *
 * The queue is inert: every agent-turn and retry job the lane's project
 * enqueues is parked a day past its own start at the queue's insert, so the
 * lane reads how long each retry was meant to wait and delivers it itself,
 * as pg-boss would once the wait is over. No sandbox, provider or model is
 * touched. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { taskRunFailureClass } from '../../../lib/shared/task-run-failure.ts';
import { createTaskList } from '../../jobs/task-list.ts';
import {
  failAgentRunFromTurn,
  getLatestAgentRunCardForTask,
} from './agent-runs.ts';
import { holdAgentJobs, type Recorder } from './delegated-start.integration.ts';
import { automatedStartWindow } from './delegated-start.ts';

/** How long each attempt works before its sandbox runs out of memory. */
const WORKED_MS = 20 * 60_000;
/** The waits before the first, second and third retry. */
const WAITS_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000];
const DAY_MS = 24 * 60 * 60_000;

export async function checkOutOfMemoryRetryBudget(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const projectId = randomUUID();
  const agentId = randomUUID();
  const taskId = randomUUID();
  const now = Date.now();
  const retryWorker = createTaskList({ sql })['task.agent_retry'];
  if (retryWorker === undefined) {
    throw new Error('itest: the retry worker is missing');
  }
  const release = await holdAgentJobs(sql, `oom_${suffix}`, [projectId], {
    keepDelay: true,
  });

  /** Hand a held retry job to the real worker, as pg-boss would once its
   * wait is over; answers the skip reasons it logged. */
  const deliver = async (payload: unknown): Promise<string[]> => {
    const skips: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => {
      const line = args.map(String).join(' ');
      const match = /auto-retry skipped: (\S+)/.exec(line);
      if (match?.[1] !== undefined) skips.push(match[1]);
      else log(...args);
    };
    try {
      await retryWorker(payload);
    } finally {
      console.log = log;
    }
    return skips;
  };
  /** The retry jobs a failed run's mark sent, and how long each was meant
   * to wait: the lane's hold parked it a day past that. */
  const heldRetries = async (runId: string) =>
    (
      await sql<{ data: unknown; delayMs: number }[]>`
        SELECT data,
               (extract(epoch FROM start_after - created_on) * 1000)::float8
                 AS "delayMs"
        FROM pgboss.job
        WHERE name = 'task.agent_retry'
          AND data ->> 'expectedRunId' = ${runId}
      `
    ).map((job) => ({ data: job.data, waitMs: job.delayMs - DAY_MS }));
  const runs = () =>
    sql<
      {
        id: string;
        execId: string;
        status: string;
        trigger: string | null;
        startedBy: string;
        attempt: number | null;
        failureCode: string | null;
      }[]
    >`
      SELECT id, exec_id AS "execId", status, trigger,
             started_by AS "startedBy", auto_retry_attempt AS attempt,
             failure_code AS "failureCode"
      FROM app.project_agent_runs WHERE task_id = ${taskId} ORDER BY seq
    `;
  const describe = (rows: Awaited<ReturnType<typeof runs>>) =>
    rows
      .map(
        (run) =>
          `${run.status}/${run.trigger ?? 'manual'}#${run.attempt ?? 0}/${run.failureCode ?? '-'}`,
      )
      .join(',') || 'none';
  const cardOf = async () => {
    const card = await getLatestAgentRunCardForTask(sql, orgId, taskId);
    return card === null
      ? null
      : {
          status: card.status,
          failureCode: card.failureCode ?? null,
          retryPending: card.retryPending === true,
        };
  };
  const notices = () =>
    sql<{ userId: string; bodyKey: string }[]>`
      SELECT user_id AS "userId", body_key AS "bodyKey"
      FROM app.user_notifications
      WHERE org_id = ${orgId} AND task_id = ${taskId}
        AND type = 'agent_run_failed'
    `;
  /** The newest run at work for {@link WORKED_MS}, then ended by its
   * sandbox's memory limit, by the turn's own failure mark. */
  const runOutOfMemory = async (run: { id: string; execId: string }) => {
    const at = Date.now();
    await sql`
      UPDATE app.project_agent_runs SET status = 'running',
        started_at_ms = ${at - WORKED_MS - 1_000},
        launched_at_ms = ${at - WORKED_MS}, updated_at_ms = ${at}
      WHERE id = ${run.id} AND status IN ('queued', 'running')
    `;
    await failAgentRunFromTurn(sql, {
      runId: run.id,
      execId: run.execId,
      error: 'itest: the sandbox ran out of memory',
      failureCode: 'resource_exhausted',
    });
  };

  try {
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
                                updated_at_ms)
      VALUES (${projectId}, ${orgId}, 'Out of memory', ${userId}, ${now},
              ${now})
    `;
    await sql`
      INSERT INTO app.project_agents (id, org_id, project_id, name, harness,
                                      model, created_by, created_at_ms,
                                      updated_at_ms)
      VALUES (${agentId}, ${orgId}, ${projectId}, 'Memory-hungry agent',
              'claude-code', 'itest-model', ${userId}, ${now}, ${now})
    `;
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
        assignee_type, assignee_id, created_by, created_by_type,
        created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${orgId}, ${projectId}, 'A build too big for its sandbox',
        'in_progress', ${`o${suffix}`}, 'agent', ${agentId}, ${userId},
        'user', ${now}, ${now})
    `;
    // A person's own Start.
    await sql`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, started_by, trigger, started_at_ms, deadline_at_ms,
        updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${taskId}, ${agentId}, ${`exec-oom-${suffix}`},
        ${`pa-${agentId}`}, 'running', 'claude-code', 'itest-model',
        ${userId}, 'manual', ${now}, ${now + 3_600_000}, ${now}
      )
    `;

    // ---- three retries, 2, 10 and 30 minutes after each failure ---------
    const waits: number[] = [];
    const jobs: number[] = [];
    const pending: boolean[] = [];
    const skips: string[] = [];
    const windows: string[] = [];
    for (let retry = 0; retry < WAITS_MS.length; retry++) {
      const failing = (await runs()).at(-1);
      if (failing === undefined) break;
      await runOutOfMemory(failing);
      const held = await heldRetries(failing.id);
      jobs.push(held.length);
      pending.push((await cardOf())?.retryPending === true);
      const job = held[0];
      if (held.length !== 1 || job === undefined) break;
      waits.push(job.waitMs);
      skips.push(...(await deliver(job.data)));
      const breaker = await automatedStartWindow(sql, {
        id: taskId,
        organizationId: orgId,
      });
      windows.push(breaker.admitted ? 'open' : 'closed');
    }
    const chain = await runs();
    const retries = chain.slice(1);
    const toldMeanwhile = await notices();
    record(
      'out of memory: each failure after 20 minutes of work holds its retry 2, then 10, then 30 minutes while the card shows it coming, and the worker starts attempts 1, 2 and 3 for the person who started the run, telling nobody [TASK-R84]',
      jobs.join(',') === '1,1,1' &&
        waits.length === WAITS_MS.length &&
        waits.every(
          (wait, index) => Math.abs(wait - (WAITS_MS[index] ?? 0)) < 5_000,
        ) &&
        pending.every(Boolean) &&
        skips.length === 0 &&
        chain.length === 4 &&
        retries.map((run) => run.attempt).join(',') === '1,2,3' &&
        retries.every(
          (run) => run.trigger === 'auto_retry' && run.startedBy === userId,
        ) &&
        retries.at(-1)?.status === 'queued' &&
        toldMeanwhile.length === 0,
      `held jobs=${jobs.join(',')} (want 1,1,1) waits=${waits.map((wait) => Math.round(wait / 1_000)).join(',')}s (want 120,600,1800) card pending=${pending.join(',')} (want all true) skips=${skips.join(',') || 'none'} (want none) runs=${describe(chain)} (want the person's run, then auto_retry #1, #2, #3, the last queued) startedBy=${retries.map((run) => (run.startedBy === userId ? 'starter' : run.startedBy)).join(',')} told=${toldMeanwhile.length} (want 0)`,
    );
    // Every run of the chain started within the hour: counting the person's
    // own start would close the window after the second retry already.
    record(
      "out of memory: the task's hourly breaker counts each automatic retry of the person's run but not the person's own start, so its window stays open after the first and second retry and is spent after the third [TASK-R12]",
      windows.join(',') === 'open,open,closed',
      `breaker after each retry=${windows.join(',') || 'none'} (want open,open,closed)`,
    );

    // ---- the third retry runs out of memory too: final at once ----------
    const third = chain.at(-1);
    if (third !== undefined && third.attempt === 3) {
      await runOutOfMemory(third);
    }
    const finalHeld = third === undefined ? [] : await heldRetries(third.id);
    const finalRuns = await runs();
    const finalRun = finalRuns.at(-1);
    const finalCard = await cardOf();
    const told = await notices();
    record(
      'out of memory: when the third retry runs out of memory too, the run fails for good at once — no retry held, the card reads it as final and out of memory, and the starter is told once [TASK-R84]',
      third?.attempt === 3 &&
        finalHeld.length === 0 &&
        finalRuns.length === 4 &&
        finalRuns.every((run) => run.status === 'failed') &&
        finalRun?.id === third.id &&
        finalCard?.status === 'failed' &&
        finalCard.failureCode === 'resource_exhausted' &&
        taskRunFailureClass(finalCard.failureCode) === 'out_of_memory' &&
        !finalCard.retryPending &&
        told.length === 1 &&
        told[0]?.userId === userId,
      `third attempt=${third?.attempt ?? 'none'} (want 3) held=${finalHeld.length} (want 0) runs=${describe(finalRuns)} (want four failed) card=${JSON.stringify(finalCard)} (want failed, resource_exhausted, not pending) told=${JSON.stringify(told.map((row) => [row.userId === userId ? 'starter' : row.userId, row.bodyKey]))} (want the starter, once)`,
    );
  } finally {
    await release();
    // The notice's debounced email finds its row gone and sends nothing.
    await sql`
      DELETE FROM app.user_notifications
      WHERE org_id = ${orgId} AND task_id = ${taskId}
    `;
    // Cascades to its agent, task and runs.
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
  }
}
