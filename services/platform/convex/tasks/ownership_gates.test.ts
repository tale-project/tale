// The ownership-transfer gates: while ANY engine (a subject-linked automation
// run or a task-agent run) is live on a task, `assignTask` refuses the
// transfer, `bulkUpdateTasks` skips the row, and `startTaskAgentRun` refuses
// to stack the agent lane on top of a live automation run. Locked against a
// real convex-test backend so the client's cancel-then-reassign flow has an
// invariant it can rely on.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'tasks';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG = 'org_gates';
const EDITOR = 'u_editor';
const DESK = 'vat-desk';

type T = TestConvex<typeof schema>;

async function seedWorld(t: T): Promise<{
  projectId: Id<'projects'>;
  agentId: Id<'projectAgents'>;
  taskId: Id<'tasks'>;
}> {
  return t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${EDITOR}_${ORG}`,
      userId: EDITOR,
      organizationId: ORG,
      role: 'editor',
      createdAt: 0,
    });
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Apollo',
      createdBy: EDITOR,
      createdAt: 0,
      updatedAt: 0,
    });
    const agentId = await ctx.db.insert('projectAgents', {
      organizationId: ORG,
      projectId,
      name: 'Helper',
      harness: 'claude-code',
      model: 'z-ai/glm-5',
      skills: [],
      connectors: [],
      createdBy: EDITOR,
      createdAt: 0,
      updatedAt: 0,
    });
    const taskId = await ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 'VAT return 2026Q1',
      status: 'in_progress',
      rank: 'a0',
      assigneeType: 'app',
      assigneeId: DESK,
      createdBy: DESK,
      createdByType: 'app',
      createdAt: 0,
      updatedAt: 0,
    });
    return { projectId, agentId, taskId };
  });
}

/** A non-terminal subject-linked run operating `taskId`. */
async function seedLiveAutomationRun(
  t: T,
  projectId: Id<'projects'>,
  taskId: Id<'tasks'>,
  status: 'queued' | 'running' | 'waiting' | 'success' = 'running',
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('automationRuns', {
      organizationId: ORG,
      name: DESK,
      version: 1,
      projectId,
      status,
      mode: 'live',
      startedBy: `user:${EDITOR}`,
      input: { task: { id: String(taskId) } },
      startedAt: 0,
    });
  });
}

describe('assignTask ownership gate', () => {
  it('refuses a transfer while a subject-linked automation run is live', async () => {
    const t = convexTest(schema, modules);
    const { projectId, taskId } = await seedWorld(t);
    await seedLiveAutomationRun(t, projectId, taskId);

    await expect(
      t
        .withIdentity({ subject: EDITOR })
        .mutation(api.tasks.mutations.assignTask, {
          taskId,
          assigneeType: 'user',
          assigneeId: EDITOR,
        }),
    ).rejects.toThrow(/TASK_HAS_LIVE_RUN/);
  });

  it('refuses an unassign while the run is live', async () => {
    const t = convexTest(schema, modules);
    const { projectId, taskId } = await seedWorld(t);
    await seedLiveAutomationRun(t, projectId, taskId, 'waiting');

    await expect(
      t
        .withIdentity({ subject: EDITOR })
        .mutation(api.tasks.mutations.assignTask, { taskId }),
    ).rejects.toThrow(/TASK_HAS_LIVE_RUN/);
  });

  it('allows the transfer once the run is terminal', async () => {
    const t = convexTest(schema, modules);
    const { projectId, taskId } = await seedWorld(t);
    await seedLiveAutomationRun(t, projectId, taskId, 'success');

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.assignTask, {
        taskId,
        assigneeType: 'user',
        assigneeId: EDITOR,
      });
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task).toMatchObject({ assigneeType: 'user', assigneeId: EDITOR });
  });

  it('a same-assignee write is a no-op change and passes the gate', async () => {
    const t = convexTest(schema, modules);
    const { projectId, taskId } = await seedWorld(t);
    await seedLiveAutomationRun(t, projectId, taskId);
    // The app-assignee validation wants a deployed automation of that name.
    await t.run(async (ctx) => {
      await ctx.db.insert('automationDeployments', {
        organizationId: ORG,
        name: DESK,
        version: 1,
        deployedBy: `user:${EDITOR}`,
        deployedAt: 0,
      });
    });

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.assignTask, {
        taskId,
        assigneeType: 'app',
        assigneeId: DESK,
      });
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task).toMatchObject({ assigneeType: 'app', assigneeId: DESK });
  });

  it('refuses a transfer while a task-agent run is live', async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentId, taskId } = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, {
        assigneeType: 'agent',
        assigneeId: String(agentId),
      });
      await ctx.db.insert('projectAgentRuns', {
        organizationId: ORG,
        projectId,
        taskId,
        agentId,
        execId: 'exec-1',
        sessionId: 'pa-test',
        status: 'running',
        harness: 'claude-code',
        model: 'z-ai/glm-5',
        startedBy: EDITOR,
        startedAt: 0,
        deadlineAt: 10_000,
        updatedAt: 0,
      });
    });

    await expect(
      t
        .withIdentity({ subject: EDITOR })
        .mutation(api.tasks.mutations.assignTask, {
          taskId,
          assigneeType: 'user',
          assigneeId: EDITOR,
        }),
    ).rejects.toThrow(/TASK_HAS_LIVE_RUN/);
  });
});

describe('bulkUpdateTasks ownership gate', () => {
  it('skips a mid-run row instead of aborting the batch', async () => {
    const t = convexTest(schema, modules);
    const { projectId, taskId } = await seedWorld(t);
    await seedLiveAutomationRun(t, projectId, taskId);
    const freeTaskId = await t.run((ctx) =>
      ctx.db.insert('tasks', {
        organizationId: ORG,
        projectId,
        title: 'Plain task',
        status: 'todo',
        rank: 'a1',
        createdBy: EDITOR,
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
      }),
    );

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.bulkUpdateTasks, {
        taskIds: [taskId, freeTaskId],
        assigneeType: 'user',
        assigneeId: EDITOR,
      });
    expect(result).toEqual({ updated: 1, skipped: 1 });

    const [owned, free] = await t.run(async (ctx) => [
      await ctx.db.get(taskId),
      await ctx.db.get(freeTaskId),
    ]);
    expect(owned).toMatchObject({ assigneeType: 'app', assigneeId: DESK });
    expect(free).toMatchObject({ assigneeType: 'user', assigneeId: EDITOR });
  });
});

describe('startTaskAgentRun automation-lane gate', () => {
  it('refuses while an automation run operates the task', async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentId, taskId } = await seedWorld(t);
    // Hand the task to the agent while the automation run is still live —
    // possible via the API surface only through races; the gate holds anyway.
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, {
        assigneeType: 'agent',
        assigneeId: String(agentId),
      });
    });
    await seedLiveAutomationRun(t, projectId, taskId);

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    expect(result).toEqual({ started: false, reason: 'automation_run_live' });
    const runs = await t.run((ctx) =>
      ctx.db.query('projectAgentRuns').collect(),
    );
    expect(runs).toHaveLength(0);
  });
});
