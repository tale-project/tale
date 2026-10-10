/** Real Postgres proof that the automatic retry of a run an automation or
 * another agent started (`started_via`, migration 0139) starts at once while
 * its agent works another task: each run of an agent takes a worker of its
 * own when it starts (`agent-workers.ts`), so the retry neither waits for
 * the agent nor is refused because of it.
 *
 * - the sequence that once put two runs in one workspace — a delegated task
 *   fails, the manager starts the agent on another task, the failed task's
 *   retry arrives — starts the retry beside the other run: two live runs of
 *   the agent, one per task, the retry the same chain's automatic retry
 *   (its starter, delegated provenance, workspace family) at its first
 *   attempt, with no later check queued and the agent row untouched;
 * - what an earlier image left behind still works: a later check it queued
 *   for a retry that waited (`task.agent_retry_recheck`, `agentBusyWaits`)
 *   now simply starts the retry, and a retry it refused for good
 *   (`auto_retry_refused_at_ms`, migration 0141, with its `agent_busy` row
 *   on the timeline) stays retired while the manager's next start runs;
 * - a confined retry works in the member's own workspace family;
 * - every delivery re-reads the task and the starter: a person's move, a
 *   reassignment, an archived task or project and a starter who lost the
 *   Editor role start nothing and retire the retry; an unchanged task
 *   starts;
 * - a payload naming another organization starts nothing, and a person's
 *   run and its retry are judged as before.
 *
 * The queue is inert: every agent-turn and retry job the lane's projects
 * enqueue is parked a day past its own start at the queue's insert, no
 * worker takes one, and the lane delivers each retry job itself, as pg-boss
 * would. No sandbox, provider or model is touched, and no worker is claimed:
 * a run the lane starts stays queued in its family's first workspace. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import { memberSessionIdForProjectAgent } from '../../core/sandbox/session_naming.ts';
import { createTaskList } from '../../jobs/task-list.ts';
import {
  archiveProject,
  getProjectAuthContext,
  restoreProject,
} from '../projects/service.ts';
import { failAgentRunFromTurn, settleAgentRun } from './agent-runs.ts';
import {
  describeRuns,
  fixtures,
  holdAgentJobs,
  runsOf,
  type LaneCtx,
  type Recorder,
} from './delegated-start.integration.ts';
import {
  startDelegatedAgentRun,
  type DelegatedAgentStart,
} from './delegated-start.ts';
import {
  archiveTask,
  assignTask,
  recordActivity,
  updateTaskStatus,
} from './service.ts';

/** The SQLSTATE an error carries, else its text. */
function codeOf(error: unknown): string {
  return error instanceof Error && 'code' in error
    ? String(error.code)
    : String(error);
}

interface RetryJob {
  id: string;
  /** The queue it was sent to. */
  name: string;
  data: Record<string, unknown>;
}

/** The queues a failed run's retry is delivered on: the arm, and the later
 * checks an earlier image queued for a retry that waited for its agent. */
const RETRY_QUEUES = ['task.agent_retry', 'task.agent_retry_recheck'];

export async function checkAutomatedRetryAgentBusy(
  sql: Sql,
  base: string,
  ctx: LaneCtx,
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const fx = fixtures(sql, ctx);
  const { suffix } = fx;
  const projectA = randomUUID();
  const foreignOrg = randomUUID();
  const foreignProject = randomUUID();
  const manager = randomUUID();
  const worker = randomUUID();
  const editor = `busy-editor-${suffix}`;
  const standing = `pa-${worker}`;
  const release = await holdAgentJobs(sql, suffix, [projectA, foreignProject], {
    keepDelay: true,
  });
  const owner = {
    organizationId: orgId,
    userId,
    role: 'owner',
    teamIds: [] as string[],
  };

  const tasks = createTaskList({ sql });
  /** The outcome lines of the delivery running in this async context — one
   * list per delivery (the harness's own `record` lines always print). */
  const heard = new AsyncLocalStorage<string[]>();
  const consoleLog = console.log;
  const OUTCOME = /auto-retry skipped: (\S+)/;

  /** Hand a retry job to the real worker of its queue, as pg-boss would;
   * answers what it logged: `skipped:<reason>`, nothing when it started the
   * retry. */
  const deliver = async (
    payload: unknown,
    queue = 'task.agent_retry',
  ): Promise<string[]> => {
    const handler = tasks[queue];
    if (handler === undefined) {
      throw new Error(`itest: no worker for ${queue}`);
    }
    const lines: string[] = [];
    await heard.run(lines, () => handler(payload));
    return lines.map((line) => {
      const match = OUTCOME.exec(line);
      return `skipped:${match?.[1]}`;
    });
  };
  const retryJobsOf = (runId: string) =>
    sql<RetryJob[]>`
      SELECT id, name, data
      FROM pgboss.job
      WHERE name IN ${sql(RETRY_QUEUES)}
        AND data ->> 'expectedRunId' = ${runId}
      ORDER BY created_on, id
    `;
  /** When the failed run's automatic retry was retired, if it was. */
  const retiredAt = async (runId: string): Promise<string | null> => {
    const rows = await sql<{ at: string | null }[]>`
      SELECT auto_retry_refused_at_ms::text AS at
      FROM app.project_agent_runs WHERE id = ${runId}
    `;
    return rows[0]?.at ?? null;
  };
  /** The agent's live runs in this organization, oldest first. */
  const liveOf = (agentId: string) =>
    sql<{ id: string; taskId: string; trigger: string | null }[]>`
      SELECT id, task_id AS "taskId", trigger FROM app.project_agent_runs
      WHERE org_id = ${orgId} AND agent_id = ${agentId}
        AND status IN ('queued', 'running')
      ORDER BY seq
    `;
  const retryAttempt = async (runId: string) => {
    const rows = await sql<{ attempt: number | null }[]>`
      SELECT auto_retry_attempt AS attempt
      FROM app.project_agent_runs WHERE id = ${runId}
    `;
    return rows[0]?.attempt ?? null;
  };
  const refusalsOf = (taskId: string) =>
    sql<{ actorId: string; toValue: string | null }[]>`
      SELECT actor_id AS "actorId", to_value AS "toValue"
      FROM app.task_activity
      WHERE task_id = ${taskId} AND action = 'agent_run.refused'
      ORDER BY id
    `;
  const agentVersion = async (agentId: string): Promise<string> => {
    const rows = await sql<{ version: string }[]>`
      SELECT xmin::text AS version FROM app.project_agents WHERE id = ${agentId}
    `;
    return rows[0]?.version ?? 'missing';
  };
  /** Settle every live run of the agent, so it is free again. */
  const free = async (agentId: string) => {
    for (const run of await liveOf(agentId)) {
      await settleAgentRun(sql, { runId: run.id, resultText: 'itest: done' });
    }
  };

  let managerRun = '';
  /** The manager's `task_start_agent`, as the tool door runs it: the
   * delegated start in a serializable transaction, for the editor its run
   * answers to. */
  const delegate = (
    taskId: string,
    extra: { agentId?: string } = {},
  ): Promise<DelegatedAgentStart> =>
    transactSerializable(sql, (tx) =>
      startDelegatedAgentRun(tx, {
        organizationId: orgId,
        scopeProjectIds: [projectA],
        taskId,
        startedBy: editor,
        via: { kind: 'agent', runId: managerRun, agentId: manager },
        ...extra,
      }),
    );
  /** Fail the task's newest run as a crashed turn does; answers the retry
   * job that failure armed. */
  const failNewest = async (
    taskId: string,
  ): Promise<{ runId: string; payload: Record<string, unknown> }> => {
    const newest = (await runsOf(sql, taskId)).at(-1);
    if (newest === undefined) {
      throw new Error(`itest: task ${taskId} has no run to fail`);
    }
    await failAgentRunFromTurn(sql, {
      runId: newest.id,
      execId: newest.execId,
      error: 'itest: the harness exited before the turn completed',
      failureCode: 'turn_crashed',
    });
    const jobs = await retryJobsOf(newest.id);
    const payload = jobs[0]?.data;
    if (jobs.length !== 1 || payload === undefined) {
      throw new Error(`itest: ${jobs.length} retry jobs armed (want 1)`);
    }
    return { runId: newest.id, payload };
  };
  /** A task the manager handed the worker whose run then failed: its retry
   * armed. */
  const failedDelegation = async (title: string) => {
    const taskId = await fx.insertTask({ projectId: projectA, title });
    const started = await delegate(taskId, { agentId: worker });
    if (started.outcome !== 'started') {
      throw new Error(`itest: delegating ${title} answered ${started.outcome}`);
    }
    return { taskId, ...(await failNewest(taskId)) };
  };
  /** The manager puts the worker to work on another task. */
  const occupy = async (title: string) => {
    const taskId = await fx.insertTask({ projectId: projectA, title });
    const started = await delegate(taskId, { agentId: worker });
    return { taskId, outcome: started.outcome };
  };
  const editorAuth = () =>
    getProjectAuthContext(sql, {
      organizationId: orgId,
      userId: editor,
      role: 'editor',
    });

  console.log = (...args: unknown[]) => {
    const lines = heard.getStore();
    const line = args.map(String).join(' ');
    if (lines !== undefined && OUTCOME.test(line)) {
      lines.push(line);
      return;
    }
    consoleLog(...args);
  };
  try {
    await fx.insertUser(editor, 'editor');
    await fx.insertProject(projectA, 'Busy agent retries');
    await fx.insertAgent(manager, projectA, 'Fleet manager');
    await fx.insertAgent(worker, projectA, 'Implementer');
    const roleTask = await fx.insertTask({
      projectId: projectA,
      title: 'Manager role',
      status: 'in_progress',
      agentId: manager,
    });
    // The manager's own live run, started by the editor in its standing
    // workspace: what the tool door finds for its session.
    const managerRows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, trigger, started_by, started_at_ms, launched_at_ms,
        deadline_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${projectA}, ${roleTask}, ${manager},
        ${`exec-${randomUUID().slice(0, 12)}`}, ${`pa-${manager}`}, 'running',
        'claude-code', 'itest-model', 'manual', ${editor},
        ${Date.now() - 2_000}, ${Date.now() - 1_000},
        ${Date.now() + 3_600_000}, ${Date.now()}
      ) RETURNING id
    `;
    managerRun = managerRows[0]?.id ?? '';

    // ---- the reported sequence: B starts first, then A's retry ---------
    {
      const a = await failedDelegation('Delegated work that fails');
      const b = await occupy('Next work for the agent');
      const agentBefore = await agentVersion(worker);
      const log = await deliver(a.payload);
      const agentAfter = await agentVersion(worker);
      const aRuns = await runsOf(sql, a.taskId);
      const retry = aRuns[1];
      const attempt = retry === undefined ? null : await retryAttempt(retry.id);
      const live = await liveOf(worker);
      const checks = (await retryJobsOf(a.runId)).filter(
        (job) => job.name === 'task.agent_retry_recheck',
      );
      record(
        'busy agent retry: a delegated task fails, the manager starts the agent on another task, and the failed task’s retry then starts at once beside it — two runs of the agent, one per task, the retry the same chain’s automatic retry at its first attempt, no later check queued, nothing refused and the agent row untouched',
        b.outcome === 'started' &&
          log.length === 0 &&
          describeRuns(aRuns) === 'failed/delegated,queued/auto_retry' &&
          retry?.startedBy === editor &&
          retry.startedVia === 'agent' &&
          retry.viaRunId === managerRun &&
          retry.viaAgentId === manager &&
          retry.sessionId === standing &&
          attempt === 1 &&
          JSON.stringify(live.map((run) => run.taskId).toSorted()) ===
            JSON.stringify([a.taskId, b.taskId].toSorted()) &&
          checks.length === 0 &&
          agentAfter === agentBefore &&
          (await refusalsOf(a.taskId)).length === 0,
        `B=${b.outcome} log=${JSON.stringify(log)} A runs=${describeRuns(aRuns)} retry=${JSON.stringify(retry)} attempt=${attempt} live=${JSON.stringify(live)} checks=${checks.length} agent row written=${agentAfter !== agentBefore}`,
      );
      await free(worker);
    }

    // ---- what an earlier image left behind ------------------------------
    {
      // A later check it queued for a retry that waited for its agent.
      const a = await failedDelegation('Waited under the earlier image');
      const b = await occupy('Work that held the agent then');
      const checkLog = await deliver(
        { ...a.payload, agentBusyWaits: 3 },
        'task.agent_retry_recheck',
      );
      const armLog = await deliver(a.payload);
      const aRuns = await runsOf(sql, a.taskId);
      record(
        'busy agent retry: a later check an earlier image queued for a retry that waited for its agent now starts the retry, and the arm delivered after it stands down — one retry',
        b.outcome === 'started' &&
          checkLog.length === 0 &&
          JSON.stringify(armLog) === JSON.stringify(['skipped:superseded']) &&
          describeRuns(aRuns) === 'failed/delegated,queued/auto_retry',
        `B=${b.outcome} check=${JSON.stringify(checkLog)} arm=${JSON.stringify(armLog)} runs=${describeRuns(aRuns)}`,
      );
      await free(worker);

      // A retry it refused for good: the mark on the failed run and the
      // refusal on the timeline, as its refusal wrote them together.
      const refused = await failedDelegation('Refused under the earlier image');
      await sql`
        UPDATE app.project_agent_runs
        SET auto_retry_refused_at_ms = ${Date.now()}
        WHERE id = ${refused.runId}
      `;
      await sql.begin((tx) =>
        recordActivity(tx, {
          task: {
            id: refused.taskId,
            organizationId: orgId,
            projectId: projectA,
          },
          actorType: 'agent',
          actorId: worker,
          action: 'agent_run.refused',
          toValue: 'agent_busy',
        }),
      );
      const arm = await deliver(refused.payload);
      const check = await deliver(
        { ...refused.payload, agentBusyWaits: 24 },
        'task.agent_retry_recheck',
      );
      const refusedRuns = await runsOf(sql, refused.taskId);
      const refusals = await refusalsOf(refused.taskId);
      const restart = await delegate(refused.taskId);
      record(
        'busy agent retry: a retry an earlier image refused for good stays retired — its arm and a check it queued start nothing and add no refusal, the agent_busy refusal stays on the timeline, and the manager’s next start of the task runs',
        JSON.stringify(arm) === JSON.stringify(['skipped:retry_refused']) &&
          JSON.stringify(check) === JSON.stringify(['skipped:retry_refused']) &&
          describeRuns(refusedRuns) === 'failed/delegated' &&
          refusals.length === 1 &&
          refusals[0]?.toValue === 'agent_busy' &&
          refusals[0].actorId === worker &&
          restart.outcome === 'started',
        `arm=${JSON.stringify(arm)} check=${JSON.stringify(check)} runs=${describeRuns(refusedRuns)} refusals=${JSON.stringify(refusals)} restart=${restart.outcome}`,
      );
      await free(worker);
    }

    // ---- a confined retry works in the member's own family ---------------
    {
      // The chain's person lost the Editor role but the task is their own,
      // so the retry works in their own workspace family.
      const ownTask = randomUUID();
      await sql`
        INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
          assignee_type, assignee_id, created_by, created_by_type,
          created_at_ms, updated_at_ms)
        VALUES (${ownTask}, ${orgId}, ${projectA}, 'The editor’s own task',
          'todo', ${`z${suffix}own`}, 'agent', ${worker}, ${editor}, 'user',
          ${Date.now()}, ${Date.now()})
      `;
      const ownStart = await delegate(ownTask);
      const own = await failNewest(ownTask);
      const standingBusy = await occupy('Standing work while confined');
      await fx.setRole(editor, 'member');
      const log = await deliver(own.payload);
      await fx.setRole(editor, 'editor');
      const ownRuns = await runsOf(sql, ownTask);
      const confinedSession = memberSessionIdForProjectAgent(worker, editor);
      record(
        'busy agent retry: a confined retry starts at once beside the agent’s standing run, in the member’s own workspace family',
        ownStart.outcome === 'started' &&
          standingBusy.outcome === 'started' &&
          log.length === 0 &&
          ownRuns[1]?.trigger === 'auto_retry' &&
          ownRuns[1].sessionId === confinedSession,
        `start=${ownStart.outcome} standing busy=${standingBusy.outcome} log=${JSON.stringify(log)} retry=${ownRuns[1]?.trigger}@${ownRuns[1]?.sessionId === confinedSession ? 'member family' : ownRuns[1]?.sessionId}`,
      );
      await free(worker);
    }

    // ---- other tenants ---------------------------------------------------
    {
      await sql`
        INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
                                  updated_at_ms)
        VALUES (${foreignProject}, ${foreignOrg}, 'Other tenant', ${userId},
                ${Date.now()}, ${Date.now()})
      `;
      const a = await failedDelegation('Beside another tenant');
      const versionBefore = await agentVersion(worker);
      const forged = await deliver({
        ...a.payload,
        organizationId: foreignOrg,
      });
      const versionAfter = await agentVersion(worker);
      const forgedRuns = await runsOf(sql, a.taskId);
      const log = await deliver(a.payload);
      const aRuns = await runsOf(sql, a.taskId);
      record(
        'busy agent retry: tenants stay apart — a retry job naming another organization touches nothing of this one and starts nothing; the real delivery starts',
        JSON.stringify(forged) ===
          JSON.stringify(['skipped:task_unavailable']) &&
          versionAfter === versionBefore &&
          describeRuns(forgedRuns) === 'failed/delegated' &&
          log.length === 0 &&
          describeRuns(aRuns) === 'failed/delegated,queued/auto_retry',
        `forged=${JSON.stringify(forged)} agent row untouched=${versionAfter === versionBefore} runs after=${describeRuns(forgedRuns)} real=${JSON.stringify(log)} runs=${describeRuns(aRuns)}`,
      );
      await free(worker);
    }

    // ---- a person's run and its retry are left as they were -------------
    {
      const busy = await occupy('Delegated work beside a person’s run');
      const personTask = await fx.insertTask({
        projectId: projectA,
        title: 'A person starts the busy agent',
        status: 'in_progress',
        agentId: worker,
      });
      const personStart = await fetch(
        `${base}/api/app/tasks/${personTask}/agent-runs/start?orgId=${orgId}`,
        {
          method: 'POST',
          headers: { cookie: ctx.cookie, origin: base },
        },
      );
      const person = await failNewest(personTask);
      const log = await deliver(person.payload);
      const personRuns = await runsOf(sql, personTask);
      record(
        'busy agent retry: the retry of a person’s run starts at once beside the agent’s other run, unattributed to any automation',
        busy.outcome === 'started' &&
          personStart.status === 200 &&
          log.length === 0 &&
          describeRuns(personRuns) === 'failed/manual,queued/auto_retry' &&
          personRuns[1]?.startedBy === userId &&
          personRuns[1].startedVia === null,
        `busy=${busy.outcome} start=${personStart.status} log=${JSON.stringify(log)} runs=${describeRuns(personRuns)}`,
      );
      await free(worker);
    }

    // ---- every delivery re-reads the task and the starter ----------------
    {
      const moved = await failedDelegation('A person moves it back');
      const reassigned = await failedDelegation('A person takes it over');
      const archived = await failedDelegation('Archived before its retry');
      const demoted = await failedDelegation('Its starter is demoted');
      const project = await failedDelegation('Its project is archived');
      const plain = await failedDelegation('Nothing changes');
      const busy = await occupy('Work beside the retries');
      const auth = await editorAuth();
      const changeErrors: string[] = [];
      const change = async (label: string, work: () => Promise<unknown>) => {
        try {
          await work();
        } catch (error) {
          changeErrors.push(`${label}: ${codeOf(error)}`);
        }
      };
      await change('move', () =>
        sql.begin((tx) => updateTaskStatus(tx, auth, moved.taskId, 'todo')),
      );
      await change('reassign', () =>
        sql.begin((tx) =>
          assignTask(tx, auth, {
            taskId: reassigned.taskId,
            assigneeType: 'user',
            assigneeId: editor,
          }),
        ),
      );
      await change('archive', () =>
        sql.begin((tx) => archiveTask(tx, owner, archived.taskId)),
      );
      const reasons: Record<string, string[]> = {};
      reasons.moved = await deliver(moved.payload);
      reasons.reassigned = await deliver(reassigned.payload);
      reasons.archived = await deliver(archived.payload);
      await fx.setRole(editor, 'member');
      reasons.demoted = await deliver(demoted.payload);
      await fx.setRole(editor, 'editor');
      reasons.plain = await deliver(plain.payload);
      await sql.begin((tx) => archiveProject(tx, owner, projectA));
      reasons.project = await deliver(project.payload);
      await sql.begin((tx) => restoreProject(tx, owner, projectA));
      const counts = async (failed: { taskId: string }) =>
        (await runsOf(sql, failed.taskId)).length;
      const shape: Record<string, number> = {
        moved: await counts(moved),
        reassigned: await counts(reassigned),
        archived: await counts(archived),
        demoted: await counts(demoted),
        project: await counts(project),
        plain: await counts(plain),
      };
      const retired = await Promise.all(
        [moved, reassigned, archived, demoted, project].map((failed) =>
          retiredAt(failed.runId),
        ),
      );
      const restoredReplay = await deliver(project.payload);
      record(
        'busy agent retry: every delivery re-reads the task and its starter — a person’s move, a reassignment, an archived task, a demoted starter and an archived project each start nothing and retire the retry, while an unchanged task starts beside the agent’s other run',
        busy.outcome === 'started' &&
          changeErrors.length === 0 &&
          retired.every((at) => at !== null) &&
          JSON.stringify(restoredReplay) ===
            JSON.stringify(['skipped:retry_refused']) &&
          JSON.stringify(reasons) ===
            JSON.stringify({
              moved: ['skipped:task_moved'],
              reassigned: ['skipped:reassigned'],
              archived: ['skipped:task_unavailable'],
              demoted: ['skipped:not_permitted'],
              plain: [],
              project: ['skipped:project_archived'],
            }) &&
          JSON.stringify(shape) ===
            JSON.stringify({
              moved: 1,
              reassigned: 1,
              archived: 1,
              demoted: 1,
              project: 1,
              plain: 2,
            }),
        `busy=${busy.outcome} changes refused=${JSON.stringify(changeErrors)} reasons=${JSON.stringify(reasons)} runs=${JSON.stringify(shape)} retired=${JSON.stringify(retired)} restoredReplay=${JSON.stringify(restoredReplay)}`,
      );
      await free(worker);
    }
  } finally {
    console.log = consoleLog;
    await release();
    await sql`
      DELETE FROM app.projects WHERE id IN (${projectA}, ${foreignProject})
    `;
    await fx.teardownUsers();
  }
}
