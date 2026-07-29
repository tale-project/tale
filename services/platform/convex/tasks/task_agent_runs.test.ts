// Coverage for the task-agent run doors — `startTaskAgentRun` and
// `cancelTaskAgentRun` run against a real convex-test backend (schema +
// modules), locking the guard matrix (agent ownership, instance existence,
// model requirement, single live run), the kick's effects (queued
// `projectAgentRuns` row + the card's move to in_progress as the caller's own
// status write), and cancel's terminal stamp. The node host it schedules is
// out of scope here (it cannot run under convex-test) — the live-run E2E
// covers that lane.

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

const ORG = 'org_runs';
const EDITOR = 'u_editor';

type T = TestConvex<typeof schema>;

async function seedWorld(
  t: T,
  options: { agentModel?: string | undefined } = { agentModel: 'z-ai/glm-5' },
): Promise<{
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
      name: 'PR Reviewer',
      harness: 'claude-code',
      ...(options.agentModel !== undefined
        ? { model: options.agentModel }
        : {}),
      skills: [],
      connectors: [],
      createdBy: EDITOR,
      createdAt: 0,
      updatedAt: 0,
    });
    const taskId = await ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 'Review the PR',
      status: 'todo',
      rank: 'a0',
      assigneeType: 'agent',
      assigneeId: agentId,
      createdBy: EDITOR,
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
    });
    return { projectId, agentId, taskId };
  });
}

describe('startTaskAgentRun', () => {
  it('inserts a queued run and moves the card to in_progress', async () => {
    const t = convexTest(schema, modules);
    const { taskId, agentId } = await seedWorld(t);

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    expect(result).toEqual({ started: true });

    const { runs, task } = await t.run(async (ctx) => ({
      runs: await ctx.db.query('projectAgentRuns').collect(),
      task: await ctx.db.get(taskId),
    }));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      taskId,
      agentId,
      status: 'queued',
      harness: 'claude-code',
      model: 'z-ai/glm-5',
      startedBy: EDITOR,
    });
    expect(runs[0]?.sessionId).toMatch(/^pa-/);
    expect(task?.status).toBe('in_progress');
  });

  it('refuses a second run while one is live', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    const asEditor = t.withIdentity({ subject: EDITOR });

    await asEditor.mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    const second = await asEditor.mutation(
      api.tasks.mutations.startTaskAgentRun,
      { taskId },
    );
    expect(second).toEqual({ started: false, reason: 'already_running' });
    const runs = await t.run((ctx) =>
      ctx.db.query('projectAgentRuns').collect(),
    );
    expect(runs).toHaveLength(1);
  });

  it('refuses when the task is not agent-owned', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, {
        assigneeType: undefined,
        assigneeId: undefined,
      });
    });

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    expect(result).toEqual({ started: false, reason: 'not_agent_owned' });
  });

  it('refuses an instance without a model (pre-model row)', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t, { agentModel: undefined });

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    expect(result).toEqual({ started: false, reason: 'agent_model_missing' });
  });

  it('refuses an assignee id that names no live instance', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { assigneeId: 'legacy-slug' });
    });

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    expect(result).toEqual({ started: false, reason: 'agent_missing' });
  });
});

describe('cancelTaskAgentRun', () => {
  it('stamps the live run cancelled and leaves the task alone', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    const asEditor = t.withIdentity({ subject: EDITOR });

    await asEditor.mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    await asEditor.mutation(api.tasks.mutations.cancelTaskAgentRun, { taskId });

    const { runs, task } = await t.run(async (ctx) => ({
      runs: await ctx.db.query('projectAgentRuns').collect(),
      task: await ctx.db.get(taskId),
    }));
    expect(runs[0]?.status).toBe('cancelled');
    expect(runs[0]?.settledAt).toBeDefined();
    expect(task?.status).toBe('in_progress');
  });

  it('is a no-op without a live run', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.cancelTaskAgentRun, { taskId });
    const runs = await t.run((ctx) =>
      ctx.db.query('projectAgentRuns').collect(),
    );
    expect(runs).toHaveLength(0);
  });
});
