/** Ordinary org/multi-bound admission and native questions, with every step
 * job deferred inside its creating transaction. No provider turn executes. */
import { randomUUID } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import { automationAskShimHandlers } from '../automations/ask-shim.ts';
import { beginRunInTx } from '../automations/store.ts';
import { updateAgentTaskMetadata } from './agent-metadata.ts';
import { kickAgentRun } from './agent-runs.ts';
import { readTaskWorkState } from './agent-work-state.ts';
import {
  fixtures,
  type LaneCtx,
  type Recorder,
} from './delegated-start.integration.ts';
import {
  findLatestAutomationRunForTask,
  findLiveAutomationRunForTask,
  startWorkflowForTaskInTx,
} from './external-ref.ts';
import { stopTaskRepeat } from './repeat.ts';
import { retireTasksInTx } from './retire.ts';
import {
  assignTask,
  createTask,
  getTaskOpsIndicators,
  loadTaskOrThrow,
  updateTaskStatus,
} from './service.ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Observe a real writer without committing any side effects on either its
 * passing or failing path. In particular a broken start never launches. */
async function rolledBack(
  sql: Sql,
  operation: (tx: TransactionSql) => Promise<unknown>,
): Promise<{ value?: unknown; code?: string }> {
  const rollback = new Error('itest: occupancy observation');
  let result: { value?: unknown; code?: string } = {};
  try {
    await sql.begin(async (tx) => {
      try {
        result = { value: await operation(tx) };
      } catch (error) {
        if (!isRecord(error) || typeof error.code !== 'string') throw error;
        result = { code: error.code };
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  return result;
}

export async function checkTaskAutomationOccupancy(
  sql: Sql,
  base: string,
  ctx: LaneCtx,
  record: Recorder,
): Promise<void> {
  const { orgId, userId, cookie } = ctx;
  const fx = fixtures(sql, ctx);
  const projectId = randomUUID();
  const otherProject = randomUUID();
  const manager = randomUUID();
  const worker = randomUUID();
  const nextWorker = randomUUID();
  const names: string[] = [];
  const runIds: string[] = [];
  const sessions: string[] = [];
  const auth = { organizationId: orgId, userId, role: 'admin', teamIds: [] };
  const api = async (taskId: string, route: string, body?: unknown) => {
    const response = await fetch(
      `${base}/api/app/tasks/${taskId}/${route}?orgId=${orgId}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    const result: unknown = await response.json();
    if (!response.ok || !isRecord(result)) {
      throw new Error(`itest: occupancy request refused (${response.status})`);
    }
    return result;
  };
  try {
    await fx.insertProject(projectId, 'Automation occupancy');
    await fx.insertProject(otherProject, 'Other automation project');
    for (const [id, name] of [
      [manager, 'Manager'],
      [worker, 'Worker'],
      [nextWorker, 'Next worker'],
    ] as const)
      await fx.insertAgent(id, projectId, name);

    for (const [label, bindings] of [
      ['org', []],
      ['multi', [projectId, otherProject]],
      ['project', [projectId]],
    ] as const) {
      const taskId = await fx.insertTask({
        projectId,
        title: `Native question ${label}`,
        agentId: worker,
      });
      const name = `itest/occupancy-${fx.suffix}-${label}`;
      names.push(name);
      const runId = await sql.begin(async (tx) => {
        // Immutable definition fixture; admission and enqueue are real.
        await tx`INSERT INTO app.automations (org_id, name, version, document, tests_passed, created_by, created_at_ms)
          VALUES (${orgId}, ${name}, 1, ${tx.json({ inputs: { type: 'object', required: ['task'], properties: { task: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } } })}, true, ${userId}, ${fx.now})`;
        await tx`INSERT INTO app.automation_deployments (org_id, name, version, deployed_by, deployed_at_ms)
          VALUES (${orgId}, ${name}, 1, ${userId}, ${fx.now})`;
        for (const bound of bindings)
          await tx`INSERT INTO app.automation_project_bindings (org_id, automation_name, project_id, bound_at_ms, bound_by)
            VALUES (${orgId}, ${name}, ${bound}, ${fx.now}, ${userId})`;
        const started = await beginRunInTx(tx, {
          organizationId: orgId,
          name,
          mode: 'live',
          startedBy: userId,
          visibleProjectIds: [projectId, otherProject],
          input: { task: { id: taskId } },
        });
        if (started === null) throw new Error('itest: run was not admitted');
        await tx`UPDATE pgboss.job SET start_after = now() + interval '1 day'
          WHERE name = 'automation.step' AND data ->> 'runId' = ${started.runId}`;
        return started.runId;
      });
      runIds.push(runId);
      const sessionId = `itest-occupancy-${randomUUID()}`;
      sessions.push(sessionId);
      // An inert native cursor/session stands in for a launched turn. The
      // real ask door resolves its run and task, and writes the question.
      await sql`UPDATE app.automation_runs SET status = 'waiting',
        checkpoints = ${sql.json({ nodes: {}, executions: 1, cursor: { node: 'ask', agent: { execId: randomUUID() } } })}
        WHERE id = ${runId}`;
      await sql`INSERT INTO app.sandbox_sessions (org_id, session_id, status, owner_type, owner_id, created_by, created_at_ms, expires_at_ms)
        VALUES (${orgId}, ${sessionId}, 'active', 'workflow_run', ${`${runId}:ask`}, ${userId}, ${fx.now}, ${fx.now + 600_000})`;
      const ask =
        automationAskShimHandlers(sql)[
          'automations/human_asks:createAskForExec'
        ];
      if (ask === undefined) throw new Error('itest: ask door is missing');
      const asked = await ask({
        organizationId: orgId,
        sessionId,
        question: 'Who should handle this task?',
      });
      if (!isRecord(asked) || typeof asked.askId !== 'string')
        throw new Error('itest: native ask was refused');
      const [beforeAsk] =
        await sql`SELECT * FROM app.automation_human_asks WHERE id = ${asked.askId}`;
      const [run] =
        await sql`SELECT project_id FROM app.automation_runs WHERE id = ${runId}`;
      record(
        `task occupancy: ${label} ordinary admission records its native task question`,
        run?.project_id === (bindings.length === 1 ? projectId : null) &&
          beforeAsk?.status === 'pending' &&
          beforeAsk.task_id === taskId,
        `project=${run?.project_id === null ? 'org' : 'exact'} ask=${String(beforeAsk?.status)}`,
      );
      const metadata = (tx: TransactionSql) =>
        updateAgentTaskMetadata(tx, {
          organizationId: orgId,
          projectId,
          actorId: manager,
          patch: {
            taskId,
            agentId: nextWorker,
            expected: { assignee: { type: 'agent', id: worker } },
          },
        });
      const agentChange = await rolledBack(sql, metadata);
      const humanChange = await rolledBack(sql, (tx) =>
        assignTask(tx, auth, {
          taskId,
          assigneeType: 'agent',
          assigneeId: nextWorker,
        }),
      );
      record(
        `task occupancy: ${label} pending question protects both assignment doors`,
        agentChange.code === 'TASK_HAS_LIVE_RUN' &&
          humanChange.code === 'TASK_HAS_LIVE_RUN' &&
          (await loadTaskOrThrow(sql, taskId, orgId)).assigneeId === worker,
        `agent=${agentChange.code ?? 'accepted'} human=${humanChange.code ?? 'accepted'}`,
      );
      await sql.begin((tx) =>
        updateAgentTaskMetadata(tx, {
          organizationId: orgId,
          projectId,
          actorId: manager,
          patch: { taskId, priority: 'p1', expected: { priority: null } },
        }),
      );
      const [afterAsk] =
        await sql`SELECT * FROM app.automation_human_asks WHERE id = ${asked.askId}`;
      const priorityTask = await loadTaskOrThrow(sql, taskId, orgId);
      record(
        `task occupancy: ${label} priority-only change preserves question and owner`,
        priorityTask.priority === 'p1' &&
          priorityTask.status === 'todo' &&
          priorityTask.assigneeId === worker &&
          JSON.stringify(afterAsk) === JSON.stringify(beforeAsk),
        `priority=${priorityTask.priority} status=${priorityTask.status}`,
      );
      const subject = { organizationId: orgId, projectId, taskId };
      const state = await readTaskWorkState(sql, { ...subject, runLimit: 5 });
      const banner = await api(taskId, 'live-automation-run');
      const latest = await api(taskId, 'latest-automation-run');
      const indicators = await getTaskOpsIndicators(sql, auth, projectId);
      record(
        `task occupancy: ${label} task readers and board expose the protected question`,
        state.workflowRun?.runId === runId &&
          state.workflowRun.ask?.askId === asked.askId &&
          isRecord(banner.run) &&
          banner.run.runId === runId &&
          isRecord(latest.run) &&
          latest.run.runId === runId &&
          indicators.askingTaskIds.includes(taskId),
        `workState=${state.workflowRun !== null} banner=${banner.run !== null} asking=${indicators.askingTaskIds.includes(taskId)}`,
      );
      const agentStart = await rolledBack(sql, (tx) =>
        kickAgentRun(tx, {
          ...subject,
          agentId: worker,
          harness: 'claude-code',
          model: 'itest-model',
          startedBy: userId,
        }),
      );
      const task = await loadTaskOrThrow(sql, taskId, orgId);
      const workflowStart = await rolledBack(sql, (tx) =>
        startWorkflowForTaskInTx(tx, {
          organizationId: orgId,
          task,
          workflowSlug: name,
          startedByUserId: userId,
        }),
      );
      record(
        `task occupancy: ${label} task starts refuse or reuse the existing engine`,
        agentStart.code === 'TASK_HAS_LIVE_RUN' &&
          isRecord(workflowStart.value) &&
          workflowStart.value.runId === runId &&
          workflowStart.value.alreadyRunning === true,
        `agent=${agentStart.code ?? 'accepted'} workflowReuse=${isRecord(workflowStart.value) && workflowStart.value.alreadyRunning === true}`,
      );
      const cancelled = await api(taskId, 'workflow/cancel', {
        status: 'todo',
      });
      const [closedAsk] =
        await sql`SELECT status FROM app.automation_human_asks WHERE id = ${asked.askId}`;
      const handedOff = await sql.begin(metadata);
      record(
        `task occupancy: ${label} ordinary task cancellation permits later assignment`,
        cancelled.executionCancelled === true &&
          closedAsk?.status === 'cancelled' &&
          handedOff.assigneeId === nextWorker,
        `cancelled=${String(cancelled.executionCancelled)} ask=${String(closedAsk?.status)}`,
      );
    }

    const target = await fx.insertTask({ projectId, title: 'Scope controls' });
    const unrelated = await fx.insertTask({
      projectId: otherProject,
      title: 'Other project subject',
    });
    for (const [label, runOrg, runProject, inputTask, status] of [
      ['foreign-org', randomUUID(), null, target, 'waiting'],
      ['foreign-project', orgId, otherProject, target, 'waiting'],
      ['other-task', orgId, null, unrelated, 'waiting'],
      ['terminal', orgId, null, target, 'success'],
      ['malformed', orgId, null, 'not-a-task-id', 'waiting'],
    ] as const) {
      const rows = await sql<{ id: string }[]>`INSERT INTO app.automation_runs
        (org_id, name, version, project_id, status, mode, started_by, input, checkpoints, started_at_ms)
        VALUES (${runOrg}, ${`itest/occupancy-${fx.suffix}-${label}`}, 1, ${runProject}, ${status}, 'live', ${userId},
          ${sql.json({ task: { id: inputTask } })}, ${sql.json({})}, ${fx.now}) RETURNING id`;
      const runId = rows[0]?.id;
      if (runId === undefined) throw new Error('itest: scope run missing');
      runIds.push(runId);
      const subject = { organizationId: orgId, projectId, taskId: target };
      const live = await findLiveAutomationRunForTask(sql, subject);
      const latest = await findLatestAutomationRunForTask(sql, subject);
      const board = await getTaskOpsIndicators(sql, auth, projectId);
      const transfer = await rolledBack(sql, (tx) =>
        updateAgentTaskMetadata(tx, {
          organizationId: orgId,
          projectId,
          actorId: manager,
          patch: {
            taskId: target,
            agentId: worker,
            expected: { assignee: null },
          },
        }),
      );
      record(
        `task occupancy: ${label} is no live ownership or project-board blocker`,
        live === null &&
          (label === 'terminal' ? latest?.runId === runId : latest === null) &&
          !board.runningTaskIds.includes(target) &&
          !board.runningTaskIds.includes(unrelated) &&
          !board.runningTaskIds.includes('not-a-task-id') &&
          isRecord(transfer.value) &&
          transfer.value.changed === true,
        `live=${live !== null} latest=${latest !== null} changed=${isRecord(transfer.value) && transfer.value.changed === true}`,
      );
      await sql`DELETE FROM app.automation_runs WHERE id = ${runId}`;
    }

    const retirement = await rolledBack(sql, async (tx) => {
      const rows = await tx<{ id: string }[]>`INSERT INTO app.automation_runs
        (org_id, name, version, project_id, status, mode, started_by, input, checkpoints, started_at_ms)
        VALUES (${orgId}, ${`itest/occupancy-${fx.suffix}-retire`}, 1, NULL, 'waiting', 'live', ${userId},
          ${tx.json({ task: { id: target } })}, ${tx.json({})}, ${fx.now}) RETURNING id`;
      const retired = await retireTasksInTx(tx, {
        organizationId: orgId,
        projectId,
        taskIds: [target],
        closedReason: 'task_deleted',
      });
      const [run] =
        await tx`SELECT status FROM app.automation_runs WHERE id = ${rows[0]?.id ?? ''}`;
      return { cancelled: retired.cancelledRunCount, status: run?.status };
    });
    record(
      'task occupancy: retirement cancels the same-org subject run before deleting its task',
      isRecord(retirement.value) &&
        retirement.value.cancelled === 1 &&
        retirement.value.status === 'cancelled',
      `result=${JSON.stringify(retirement.value)}`,
    );
    const repeat = await rolledBack(sql, async (tx) => {
      const original = await createTask(tx, auth, {
        projectId,
        title: 'Repeating occupancy control',
        status: 'todo',
        dueDate: Date.UTC(2030, 0, 7),
        repeat: {
          frequency: 'weekly',
          interval: 1,
          weekdays: [1],
          timezone: 'UTC',
        },
      });
      await updateTaskStatus(tx, auth, original, 'done');
      const copy = (await loadTaskOrThrow(tx, original, orgId))
        .repeatNextTaskId;
      if (copy === null) throw new Error('itest: repeat copy was not created');
      await tx`INSERT INTO app.automation_runs
        (org_id, name, version, project_id, status, mode, started_by, input, checkpoints, started_at_ms)
        VALUES (${orgId}, ${`itest/occupancy-${fx.suffix}-repeat`}, 1, NULL, 'waiting', 'live', ${userId},
          ${tx.json({ task: { id: copy } })}, ${tx.json({})}, ${fx.now})`;
      const stopped = await stopTaskRepeat(tx, auth, original);
      const copies = await tx`SELECT id FROM app.tasks WHERE id = ${copy}`;
      return {
        removed: stopped.removedNextTask,
        copyKept: copies.length === 1,
      };
    });
    record(
      'task occupancy: stop repeating keeps a copy an org-level run holds',
      isRecord(repeat.value) &&
        repeat.value.removed === false &&
        repeat.value.copyKept === true,
      `result=${JSON.stringify(repeat.value)}`,
    );
  } finally {
    await sql`DELETE FROM pgboss.job WHERE data ->> 'runId' = ANY(${runIds})`;
    await sql`DELETE FROM app.sandbox_sessions WHERE session_id = ANY(${sessions})`;
    await sql`DELETE FROM app.automation_runs WHERE id = ANY(${runIds})`;
    await sql`DELETE FROM app.automation_project_bindings WHERE org_id = ${orgId} AND automation_name = ANY(${names})`;
    await sql`DELETE FROM app.automation_deployments WHERE org_id = ${orgId} AND name = ANY(${names})`;
    await sql`DELETE FROM app.automations WHERE org_id = ${orgId} AND name = ANY(${names})`;
    await sql`DELETE FROM app.projects WHERE id = ANY(${[projectId, otherProject]})`;
  }
}
