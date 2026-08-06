import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root. This file lives at
// convex/tasks/, so resolve glob keys against that base (mirrors append_only.test.ts).
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

const ORG = 'org_upsert_external';
type T = TestConvex<typeof schema>;

async function seedProject(t: T, name: string): Promise<Id<'projects'>> {
  return await t.run(async (ctx) =>
    ctx.db.insert('projects', {
      organizationId: ORG,
      name,
      createdBy: 'user_1',
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

function upsert(
  t: T,
  projectId: Id<'projects'>,
  externalId: string,
  dedupeScope?: 'org' | 'project',
) {
  return t.mutation(
    internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
    {
      organizationId: ORG,
      actorId: 'user_1',
      projectId,
      externalSystem: 'github',
      externalId,
      title: `Issue ${externalId}`,
      externalState: 'open',
      ...(dedupeScope ? { dedupeScope } : {}),
    },
  );
}

async function taskProjectId(t: T, taskId: string | null): Promise<string> {
  if (!taskId) throw new Error('expected a taskId');
  return await t.run(async (ctx) => {
    const task = await ctx.db.get(taskId as Id<'tasks'>);
    if (!task) throw new Error('task not found');
    return String(task.projectId);
  });
}

async function taskStatus(t: T, taskId: string | null): Promise<string> {
  if (!taskId) throw new Error('expected a taskId');
  return await t.run(async (ctx) => {
    const task = await ctx.db.get(taskId as Id<'tasks'>);
    if (!task) throw new Error('task not found');
    return task.status;
  });
}

async function taskTitle(t: T, taskId: string | null): Promise<string> {
  if (!taskId) throw new Error('expected a taskId');
  return await t.run(async (ctx) => {
    const task = await ctx.db.get(taskId as Id<'tasks'>);
    if (!task) throw new Error('task not found');
    return task.title;
  });
}

async function taskLabelNames(
  t: T,
  taskId: string | null,
): Promise<string[] | undefined> {
  if (!taskId) throw new Error('expected a taskId');
  return await t.run(async (ctx) => {
    const task = await ctx.db.get(taskId as Id<'tasks'>);
    if (!task) throw new Error('task not found');
    if (!task.labelIds || task.labelIds.length === 0) {
      return task.labels;
    }
    const names: string[] = [];
    for (const id of task.labelIds) {
      const label = await ctx.db.get(id);
      if (label) names.push(label.name);
    }
    return names.length > 0 ? names : undefined;
  });
}

// A labelled create (what `triage-github-issues` does — issue label names).
function upsertWithLabels(
  t: T,
  projectId: Id<'projects'>,
  externalId: string,
  labels: string[],
) {
  return t.mutation(
    internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
    {
      organizationId: ORG,
      actorId: 'workflow',
      projectId,
      externalSystem: 'github',
      externalId,
      title: `Issue ${externalId}`,
      externalState: 'open',
      labels,
    },
  );
}

// The update-only reconcile call: org-scope, NO projectId, never creates.
function reconcile(t: T, externalId: string, externalState: 'open' | 'closed') {
  return t.mutation(
    internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
    {
      organizationId: ORG,
      actorId: 'workflow',
      externalSystem: 'github',
      externalId,
      title: `Issue ${externalId}`,
      externalState,
      createIfMissing: false,
    },
  );
}

describe('agentUpsertTaskByExternalRef — dedup scope', () => {
  it("dedupeScope:'project' — same issue in two projects yields two independent tasks", async () => {
    const t = convexTest(schema, modules);
    const projectA = await seedProject(t, 'Alpha');
    const projectB = await seedProject(t, 'Beta');

    const a = await upsert(t, projectA, 'owner/repo#1925', 'project');
    const b = await upsert(t, projectB, 'owner/repo#1925', 'project');

    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(a.taskId).not.toBe(b.taskId);
    // Each task lives in its OWN project — the second create did not retarget the first.
    expect(await taskProjectId(t, a.taskId)).toBe(String(projectA));
    expect(await taskProjectId(t, b.taskId)).toBe(String(projectB));
  });

  it("dedupeScope:'project' — same issue twice in one project is idempotent", async () => {
    const t = convexTest(schema, modules);
    const projectA = await seedProject(t, 'Alpha');

    const first = await upsert(t, projectA, 'owner/repo#42', 'project');
    const second = await upsert(t, projectA, 'owner/repo#42', 'project');

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.taskId).toBe(first.taskId);
  });

  it("dedupeScope:'org' (default) — same issue across projects dedups to one org-wide task", async () => {
    const t = convexTest(schema, modules);
    const projectA = await seedProject(t, 'Alpha');
    const projectB = await seedProject(t, 'Beta');

    // Default scope (arg omitted) must stay org-wide for back-compat with the
    // GitHub sync workflows.
    const a = await upsert(t, projectA, 'owner/repo#7');
    const b = await upsert(t, projectB, 'owner/repo#7');

    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.taskId).toBe(a.taskId);
    // The task stays in the project that first materialized it (projectId is not re-homed).
    expect(await taskProjectId(t, b.taskId)).toBe(String(projectA));
  });
});

describe('agentUpsertTaskByExternalRef — createIfMissing (update-only reconcile)', () => {
  it('no-ops when the issue has no task on the board (and needs no projectId)', async () => {
    const t = convexTest(schema, modules);

    const res = await reconcile(t, 'owner/repo#999', 'closed');

    expect(res).toEqual({ taskId: null, created: false });
    const count = await t.run(
      async (ctx) => (await ctx.db.query('tasks').collect()).length,
    );
    expect(count).toBe(0); // never materialized a task for an untracked issue
  });

  it('closes an existing task when its issue closed — org-scoped, without a projectId', async () => {
    const t = convexTest(schema, modules);
    const projectA = await seedProject(t, 'Alpha');

    // The desk created the task earlier (open).
    const created = await upsert(t, projectA, 'owner/repo#1851');
    expect(created.created).toBe(true);
    expect(created.taskId).not.toBeNull();

    // A PR merged out of band closed the issue; reconcile finds the task by
    // org+externalId (no projectId) and moves it to done.
    const res = await reconcile(t, 'owner/repo#1851', 'closed');

    expect(res.created).toBe(false);
    expect(res.taskId).toBe(created.taskId);
    expect(await taskStatus(t, created.taskId)).toBe('done');
  });
});

describe('agentUpsertTaskByExternalRef — title coercion', () => {
  // Regression: a GitHub issue title longer than TASK_TITLE_MAX (200) used to
  // throw TASK_TITLE_INVALID and make "Create task" unusable for long issues
  // (e.g. issue #2090, 240 chars). External titles aren't editable at the
  // import site, so they must be truncated rather than rejected.
  it('truncates an over-long external title instead of rejecting it', async () => {
    const t = convexTest(schema, modules);
    const projectA = await seedProject(t, 'Alpha');
    const longTitle = `Improvement: ${'x'.repeat(300)}`;

    const res = await t.mutation(
      internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
      {
        organizationId: ORG,
        actorId: 'user_1',
        projectId: projectA,
        externalSystem: 'github',
        externalId: 'owner/repo#2090',
        title: longTitle,
        externalState: 'open',
      },
    );

    expect(res.created).toBe(true);
    const title = await taskTitle(t, res.taskId);
    expect(title.length).toBe(200);
    expect(title.endsWith('…')).toBe(true);
    expect(longTitle.startsWith(title.slice(0, -1))).toBe(true);
  });

  it('falls back to the external ref when the source title is blank', async () => {
    const t = convexTest(schema, modules);
    const projectA = await seedProject(t, 'Alpha');

    const res = await t.mutation(
      internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
      {
        organizationId: ORG,
        actorId: 'user_1',
        projectId: projectA,
        externalSystem: 'github',
        externalId: 'owner/repo#1',
        title: '   ',
        externalState: 'open',
      },
    );

    expect(res.created).toBe(true);
    expect(await taskTitle(t, res.taskId)).toBe('github owner/repo#1');
  });
});

describe('agentUpdateTaskStatus — workflow activity context', () => {
  it('stores workflow attribution on activity rows when actorId is workflow', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, 'Ops');
    const taskId = await t.run(async (ctx) =>
      ctx.db.insert('tasks', {
        organizationId: ORG,
        projectId,
        title: 'Review me',
        status: 'backlog',
        rank: 'a0',
        createdBy: 'user_1',
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
        statusChangedAt: 0,
      }),
    );

    await t.mutation(internal.tasks.internal_mutations.agentUpdateTaskStatus, {
      organizationId: ORG,
      actorId: 'workflow',
      taskId,
      status: 'in_progress',
      attribution: {
        workflowSlug: 'task-ops/assignment',
        wfExecutionId: undefined,
      },
    });

    const activity = await t.run(async (ctx) =>
      ctx.db
        .query('taskActivity')
        .withIndex('by_task', (q) => q.eq('taskId', taskId))
        .collect(),
    );
    expect(activity).toHaveLength(1);
    expect(activity[0]?.context).toEqual({
      workflowSlug: 'task-ops/assignment',
    });
  });
});

describe('agentUpsertTaskByExternalRef — label preservation on reconcile', () => {
  // Regression: `sync-github-issues`'s `reconcile_task` re-runs every few
  // minutes and forwards NO labels. Before the guard, the update patched
  // `labels: undefined` — and a Convex patch to `undefined` DELETES the field —
  // silently wiping the labels `triage-github-issues` had set on the same task.
  it('an update-only reconcile that sends no labels preserves existing labels', async () => {
    const t = convexTest(schema, modules);
    const projectA = await seedProject(t, 'Alpha');

    const created = await upsertWithLabels(t, projectA, 'owner/repo#7', [
      'bug',
      'good first issue',
    ]);
    expect(created.created).toBe(true);
    expect(await taskLabelNames(t, created.taskId)).toEqual([
      'bug',
      'good first issue',
    ]);

    // The reconcile (createIfMissing:false, no labels) must not touch labels.
    const res = await reconcile(t, 'owner/repo#7', 'open');
    expect(res.taskId).toBe(created.taskId);
    expect(await taskLabelNames(t, created.taskId)).toEqual([
      'bug',
      'good first issue',
    ]);
  });

  it('a caller that supplies labels still overwrites them (empty array clears)', async () => {
    const t = convexTest(schema, modules);
    const projectA = await seedProject(t, 'Alpha');

    const created = await upsertWithLabels(t, projectA, 'owner/repo#8', [
      'bug',
    ]);
    // A re-run that DOES pass labels updates them; an explicit [] clears — the
    // guard only skips the patch when labels is undefined.
    await upsertWithLabels(t, projectA, 'owner/repo#8', []);
    expect(await taskLabelNames(t, created.taskId)).toBeFalsy();
  });
});

describe('agentUpsertTaskByExternalRef — reopen policy', () => {
  it('reopens a done task when the external issue is open again', async () => {
    const t = convexTest(schema, modules);
    const projectA = await seedProject(t, 'Alpha');

    const created = await upsert(t, projectA, 'owner/repo#reopen-done');
    await reconcile(t, 'owner/repo#reopen-done', 'closed');
    expect(await taskStatus(t, created.taskId)).toBe('done');

    await reconcile(t, 'owner/repo#reopen-done', 'open');
    expect(await taskStatus(t, created.taskId)).toBe('backlog');
  });

  it('does not resurrect a human-cancelled proposal while the issue stays open', async () => {
    const t = convexTest(schema, modules);
    const projectA = await seedProject(t, 'Alpha');

    const created = await upsert(t, projectA, 'owner/repo#dismissed');
    expect(await taskStatus(t, created.taskId)).toBe('backlog');

    const { taskId } = created;
    if (!taskId) throw new Error('expected a taskId');

    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, {
        status: 'cancelled',
        updatedAt: Date.now(),
        statusChangedAt: Date.now(),
      });
    });
    expect(await taskStatus(t, created.taskId)).toBe('cancelled');

    await reconcile(t, 'owner/repo#dismissed', 'open');
    expect(await taskStatus(t, created.taskId)).toBe('cancelled');
  });
});

describe('recordAgentRunRefused — admission refusals reach the activity feed', () => {
  // #2609: a refused run never creates a `taskAgentRuns` row, so without an
  // activity entry the failure is invisible on the task detail.
  it('writes an agent_run.refused activity row with the reason and workflow context', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, 'Ops');
    const taskId = await t.run(async (ctx) =>
      ctx.db.insert('tasks', {
        organizationId: ORG,
        projectId,
        title: 'Needs an agent',
        status: 'todo',
        rank: 'a0',
        createdBy: 'user_1',
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
        statusChangedAt: 0,
      }),
    );

    await t.mutation(internal.tasks.internal_mutations.recordAgentRunRefused, {
      organizationId: ORG,
      taskId,
      agentSlug: 'issue-triager',
      refusedReason: 'agent_disabled',
      attribution: {
        workflowSlug: 'projects/tasks/run-assigned-task',
        wfExecutionId: undefined,
      },
    });

    const activity = await t.run(async (ctx) =>
      ctx.db
        .query('taskActivity')
        .withIndex('by_task', (q) => q.eq('taskId', taskId))
        .collect(),
    );
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      action: 'agent_run.refused',
      actorType: 'agent',
      actorId: 'issue-triager',
      toValue: 'agent_disabled',
      context: { workflowSlug: 'projects/tasks/run-assigned-task' },
    });
    // The refusal record must never move the task itself.
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.status).toBe('todo');
  });

  it('quietly no-ops when the task is gone or in another org', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, 'Ops');
    const taskId = await t.run(async (ctx) =>
      ctx.db.insert('tasks', {
        organizationId: ORG,
        projectId,
        title: 'Foreign org task',
        status: 'todo',
        rank: 'a0',
        createdBy: 'user_1',
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
        statusChangedAt: 0,
      }),
    );

    await t.mutation(internal.tasks.internal_mutations.recordAgentRunRefused, {
      organizationId: 'org_other',
      taskId,
      agentSlug: 'issue-triager',
      refusedReason: 'agent_disabled',
      attribution: undefined,
    });

    const activity = await t.run(async (ctx) =>
      ctx.db
        .query('taskActivity')
        .withIndex('by_task', (q) => q.eq('taskId', taskId))
        .collect(),
    );
    expect(activity).toHaveLength(0);
  });
});

// Agent-run dispatch for description @mentions goes through the
// `task.mentioned` event seam alone (a logged no-op until the automations
// rewrite lands); the old workflow-engine direct-dispatch fallback died with
// its tables in the 0.4 baseline reset.
describe('agentCreateTask — description mentions', () => {
  async function scheduledAgentRuns(t: T) {
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    return scheduled.filter((job) => job.name.includes('runAgentOnTask'));
  }

  it('creates the task and schedules no agent run for the @mention — dispatch is event-seam-only', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, 'Ops');

    const { taskId } = await t.mutation(
      internal.tasks.internal_mutations.agentCreateTask,
      {
        organizationId: ORG,
        actorId: 'triager',
        projectId,
        title: 'Investigate outage',
        description: 'Needs a look — @assistant can you help?',
      },
    );

    // The task itself still materializes normally — the mention only feeds
    // the (currently no-op) event seam, never a direct schedule.
    expect(await taskTitle(t, taskId)).toBe('Investigate outage');
    expect(await scheduledAgentRuns(t)).toHaveLength(0);
  });
});

describe('scheduleTaskWorkflowStart — the create→run hand-off', () => {
  const pendingStarts = async (t: T) =>
    await t.run(async (ctx) => {
      const jobs = await ctx.db.system.query('_scheduled_functions').collect();
      return jobs.filter(
        (job) =>
          job.name.includes('startTaskWorkflowRun') &&
          job.state.kind === 'pending',
      );
    });

  it('schedules the live engine start with the task-board Start input shape', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, 'Desk');
    const taskId = await t.run(async (ctx) =>
      ctx.db.insert('tasks', {
        organizationId: ORG,
        projectId,
        title: 'Period job — 2026Q1',
        status: 'todo',
        rank: 'a0',
        externalSystem: 'desk-e2e',
        externalId: 'folder_1',
        createdBy: 'user_1',
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
      }),
    );

    await t.mutation(
      internal.tasks.internal_mutations.scheduleTaskWorkflowStart,
      {
        organizationId: ORG,
        taskId,
        workflowSlug: 'vat/prepare-return',
        userId: 'user_1',
      },
    );

    const jobs = await pendingStarts(t);
    expect(jobs).toHaveLength(1);
    const [payload] = jobs[0].args as [Record<string, unknown>];
    expect(payload).toMatchObject({
      organizationId: ORG,
      name: 'vat/prepare-return',
      taskId: String(taskId),
      projectId,
      startedBy: 'user:user_1',
      input: {
        task: {
          id: String(taskId),
          title: 'Period job — 2026Q1',
          status: 'todo',
          externalSystem: 'desk-e2e',
          externalId: 'folder_1',
        },
      },
    });
  });

  it('soft-fails on a vanished or foreign task — nothing scheduled', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, 'Desk');
    const taskId = await t.run(async (ctx) =>
      ctx.db.insert('tasks', {
        organizationId: 'org_other',
        projectId,
        title: 'Not ours',
        status: 'todo',
        rank: 'a0',
        createdBy: 'user_1',
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
      }),
    );

    await t.mutation(
      internal.tasks.internal_mutations.scheduleTaskWorkflowStart,
      {
        organizationId: ORG,
        taskId,
        workflowSlug: 'vat/prepare-return',
        userId: 'user_1',
      },
    );
    expect(await pendingStarts(t)).toHaveLength(0);
  });
});
