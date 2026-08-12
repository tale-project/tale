import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import schema from '../schema';
import { taskCountBucket } from './helpers';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/tasks/), mirroring label_catalog.test.ts.
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

const ORG = 'org_project_task_counts';
const EDITOR = 'user_editor';
const ADMIN = 'user_admin';
type T = TestConvex<typeof schema>;
type Status = Doc<'tasks'>['status'];

async function seedMember(t: T, userId: string, role: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}`,
      userId,
      organizationId: ORG,
      role,
      createdAt: 0,
    });
  });
}

/** A project seeded with explicit zero counters, exactly like `createProject`. */
async function seedProject(t: T): Promise<Id<'projects'>> {
  const projectId = await t.run((ctx) =>
    ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Counting',
      createdBy: EDITOR,
      createdAt: 0,
      updatedAt: 0,
      taskCounter: 0,
      openTaskCount: 0,
      doneTaskCount: 0,
      projectAgentCount: 0,
    }),
  );
  await seedMember(t, EDITOR, 'editor');
  return projectId;
}

let nextNumber = 0;

/**
 * Insert a task row directly AND move the project's counters to match, so a
 * seeded fixture starts in the same consistent state a real create would leave
 * behind. Direct insertion (rather than `createTask`) keeps each case's
 * starting point explicit.
 */
async function seedTask(
  t: T,
  projectId: Id<'projects'>,
  overrides: {
    status?: Status;
    archivedAt?: number;
    parentTaskId?: Id<'tasks'>;
    dueDate?: number;
  } = {},
): Promise<Id<'tasks'>> {
  nextNumber += 1;
  const status: Status = overrides.status ?? 'todo';
  const taskId = await t.run((ctx) =>
    ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: `Task ${nextNumber}`,
      status,
      rank: `a${nextNumber}`,
      number: nextNumber,
      createdBy: EDITOR,
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
      ...(overrides.archivedAt !== undefined
        ? { archivedAt: overrides.archivedAt }
        : {}),
      ...(overrides.parentTaskId
        ? { parentTaskId: overrides.parentTaskId }
        : {}),
      ...(overrides.dueDate !== undefined
        ? { dueDate: overrides.dueDate }
        : {}),
    }),
  );
  const bucket = taskCountBucket({
    status,
    archivedAt: overrides.archivedAt,
  });
  if (bucket !== 'none') {
    await t.run(async (ctx) => {
      const project = await ctx.db.get(projectId);
      if (!project) return;
      await ctx.db.patch(projectId, {
        openTaskCount:
          (project.openTaskCount ?? 0) + (bucket === 'open' ? 1 : 0),
        doneTaskCount:
          (project.doneTaskCount ?? 0) + (bucket === 'done' ? 1 : 0),
      });
    });
  }
  return taskId;
}

async function counts(
  t: T,
  projectId: Id<'projects'>,
): Promise<{ open: number; done: number; agents: number }> {
  return await t.run(async (ctx) => {
    const project = await ctx.db.get(projectId);
    return {
      open: project?.openTaskCount ?? -1,
      done: project?.doneTaskCount ?? -1,
      agents: project?.projectAgentCount ?? -1,
    };
  });
}

function asEditor(t: T) {
  return t.withIdentity({ subject: EDITOR });
}

function setup() {
  return convexTest(schema, modules);
}

describe('taskCountBucket', () => {
  it('buckets every status', () => {
    expect(taskCountBucket({ status: 'backlog', archivedAt: undefined })).toBe(
      'open',
    );
    expect(taskCountBucket({ status: 'todo', archivedAt: undefined })).toBe(
      'open',
    );
    expect(
      taskCountBucket({ status: 'in_progress', archivedAt: undefined }),
    ).toBe('open');
    expect(
      taskCountBucket({ status: 'in_review', archivedAt: undefined }),
    ).toBe('open');
    expect(taskCountBucket({ status: 'done', archivedAt: undefined })).toBe(
      'done',
    );
    expect(
      taskCountBucket({ status: 'cancelled', archivedAt: undefined }),
    ).toBe('none');
  });

  it('lets archivedAt beat every status, including done', () => {
    expect(taskCountBucket({ status: 'todo', archivedAt: 1 })).toBe('none');
    expect(taskCountBucket({ status: 'done', archivedAt: 1 })).toBe('none');
    expect(taskCountBucket({ status: 'cancelled', archivedAt: 1 })).toBe(
      'none',
    );
  });
});

describe('project rollup counters — creation', () => {
  // Driven through `agentCreateTask` rather than the public `createTask`:
  // the latter takes the user rate limiter, whose component is not registered
  // under convexTest. Both insert paths call the same `countTaskCreated`.
  it('counts a newly created task as open', async () => {
    const t = setup();
    const projectId = await seedProject(t);

    await t.mutation(internal.tasks.internal_mutations.agentCreateTask, {
      organizationId: ORG,
      actorId: 'agent_1',
      projectId,
      title: 'Fresh',
    });

    expect(await counts(t, projectId)).toMatchObject({ open: 1, done: 0 });
  });

  it('counts an external issue materialized as closed straight into done', async () => {
    const t = setup();
    const projectId = await seedProject(t);

    await t.mutation(
      internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
      {
        organizationId: ORG,
        // The SYNC engine (actorId 'workflow') is the only actor that may
        // materialize a closed issue straight to done — a free-form agent's
        // close parks at in_review instead (the completion invariant).
        actorId: 'workflow',
        projectId,
        title: 'Closed upstream',
        externalSystem: 'github',
        externalId: 'owner/repo#1',
        externalState: 'closed',
      },
    );

    // The whole reason countTaskCreated reads the INSERTED state rather than
    // assuming "create ⇒ open".
    expect(await counts(t, projectId)).toMatchObject({ open: 0, done: 1 });
  });
});

describe('project rollup counters — status transitions', () => {
  it('does not touch counts for a within-bucket move', async () => {
    const t = setup();
    const projectId = await seedProject(t);
    const taskId = await seedTask(t, projectId, { status: 'backlog' });
    const before = await counts(t, projectId);

    await asEditor(t).mutation(api.tasks.mutations.updateTaskStatus, {
      taskId,
      status: 'todo',
    });

    expect(await counts(t, projectId)).toEqual(before);
  });

  it('moves open → done and back', async () => {
    const t = setup();
    const projectId = await seedProject(t);
    const taskId = await seedTask(t, projectId, { status: 'todo' });

    await asEditor(t).mutation(api.tasks.mutations.updateTaskStatus, {
      taskId,
      status: 'done',
    });
    expect(await counts(t, projectId)).toMatchObject({ open: 0, done: 1 });

    await asEditor(t).mutation(api.tasks.mutations.updateTaskStatus, {
      taskId,
      status: 'todo',
    });
    expect(await counts(t, projectId)).toMatchObject({ open: 1, done: 0 });
  });

  it('drops a cancelled task out of both buckets and restores it', async () => {
    const t = setup();
    const projectId = await seedProject(t);
    const taskId = await seedTask(t, projectId, { status: 'todo' });

    await asEditor(t).mutation(api.tasks.mutations.updateTaskStatus, {
      taskId,
      status: 'cancelled',
    });
    expect(await counts(t, projectId)).toMatchObject({ open: 0, done: 0 });

    await asEditor(t).mutation(api.tasks.mutations.updateTaskStatus, {
      taskId,
      status: 'todo',
    });
    expect(await counts(t, projectId)).toMatchObject({ open: 1, done: 0 });
  });

  it('leaves counts alone on a same-status reorder through moveTask', async () => {
    const t = setup();
    const projectId = await seedProject(t);
    const a = await seedTask(t, projectId, { status: 'todo' });
    await seedTask(t, projectId, { status: 'todo' });
    const before = await counts(t, projectId);

    await asEditor(t).mutation(api.tasks.mutations.moveTask, {
      taskId: a,
      status: 'todo',
    });

    expect(await counts(t, projectId)).toEqual(before);
  });

  it('moves buckets on a cross-status moveTask', async () => {
    const t = setup();
    const projectId = await seedProject(t);
    const taskId = await seedTask(t, projectId, { status: 'todo' });

    await asEditor(t).mutation(api.tasks.mutations.moveTask, {
      taskId,
      status: 'done',
    });

    expect(await counts(t, projectId)).toMatchObject({ open: 0, done: 1 });
  });
});

describe('project rollup counters — archive', () => {
  it('discounts an archived open task and restores it', async () => {
    const t = setup();
    const projectId = await seedProject(t);
    const taskId = await seedTask(t, projectId, { status: 'todo' });

    await asEditor(t).mutation(api.tasks.mutations.archiveTask, { taskId });
    expect(await counts(t, projectId)).toMatchObject({ open: 0, done: 0 });

    await asEditor(t).mutation(api.tasks.mutations.restoreTask, { taskId });
    expect(await counts(t, projectId)).toMatchObject({ open: 1, done: 0 });
  });

  it('discounts an archived done task from the done bucket', async () => {
    const t = setup();
    const projectId = await seedProject(t);
    const taskId = await seedTask(t, projectId, { status: 'done' });
    expect(await counts(t, projectId)).toMatchObject({ open: 0, done: 1 });

    await asEditor(t).mutation(api.tasks.mutations.archiveTask, { taskId });
    expect(await counts(t, projectId)).toMatchObject({ open: 0, done: 0 });
  });

  it('discounts through the agent archive path', async () => {
    const t = setup();
    const projectId = await seedProject(t);
    const taskId = await seedTask(t, projectId, { status: 'done' });

    await t.mutation(internal.tasks.internal_mutations.agentArchiveTask, {
      organizationId: ORG,
      actorId: 'agent_1',
      taskId,
    });

    expect(await counts(t, projectId)).toMatchObject({ open: 0, done: 0 });
  });

  it('never drives a counter negative when the stored value has drifted low', async () => {
    const t = setup();
    const projectId = await seedProject(t);
    const taskId = await seedTask(t, projectId, { status: 'todo' });
    // Force drift: the row exists but the counter says zero.
    await t.run((ctx) => ctx.db.patch(projectId, { openTaskCount: 0 }));

    await asEditor(t).mutation(api.tasks.mutations.archiveTask, { taskId });

    expect(await counts(t, projectId)).toMatchObject({ open: 0, done: 0 });
  });
});

describe('project rollup counters — bulk and delete', () => {
  it('accumulates a delta per row across one bulk update', async () => {
    const t = setup();
    const projectId = await seedProject(t);
    const ids = [
      await seedTask(t, projectId, { status: 'todo' }),
      await seedTask(t, projectId, { status: 'todo' }),
      await seedTask(t, projectId, { status: 'todo' }),
    ];
    expect(await counts(t, projectId)).toMatchObject({ open: 3, done: 0 });

    await asEditor(t).mutation(api.tasks.mutations.bulkUpdateTasks, {
      taskIds: ids,
      status: 'done',
    });

    // Proves the helper re-reads the project each iteration instead of
    // caching a stale doc across the loop.
    expect(await counts(t, projectId)).toMatchObject({ open: 0, done: 3 });
  });

  it('handles a bulk patch that moves status AND archives in one write', async () => {
    const t = setup();
    const projectId = await seedProject(t);
    const ids = [
      await seedTask(t, projectId, { status: 'todo' }),
      await seedTask(t, projectId, { status: 'done' }),
    ];
    expect(await counts(t, projectId)).toMatchObject({ open: 1, done: 1 });

    await asEditor(t).mutation(api.tasks.mutations.bulkUpdateTasks, {
      taskIds: ids,
      status: 'done',
      archived: true,
    });

    // Both rows land in `none` — a status-only and an archive-only helper pair
    // would have double-counted this.
    expect(await counts(t, projectId)).toMatchObject({ open: 0, done: 0 });
  });

  it('restores counts on a bulk un-archive', async () => {
    const t = setup();
    const projectId = await seedProject(t);
    const ids = [
      await seedTask(t, projectId, { status: 'todo', archivedAt: 5 }),
      await seedTask(t, projectId, { status: 'done', archivedAt: 5 }),
    ];
    expect(await counts(t, projectId)).toMatchObject({ open: 0, done: 0 });

    await asEditor(t).mutation(api.tasks.mutations.bulkUpdateTasks, {
      taskIds: ids,
      archived: false,
    });

    expect(await counts(t, projectId)).toMatchObject({ open: 1, done: 1 });
  });

  it('discounts every node of a deleted subtree, not just the root', async () => {
    const t = setup();
    const projectId = await seedProject(t);
    // Hard delete is admin-gated, so this case needs its own identity.
    await seedMember(t, ADMIN, 'owner');
    const parent = await seedTask(t, projectId, { status: 'todo' });
    await seedTask(t, projectId, { status: 'todo', parentTaskId: parent });
    await seedTask(t, projectId, { status: 'todo', parentTaskId: parent });
    expect(await counts(t, projectId)).toMatchObject({ open: 3, done: 0 });

    await t
      .withIdentity({ subject: ADMIN })
      .mutation(api.tasks.mutations.deleteTask, { taskId: parent });

    // Counting in `deleteTaskTree` rather than `deleteTask` is what makes the
    // two children land here too.
    expect(await counts(t, projectId)).toMatchObject({ open: 0, done: 0 });
  });
});

describe('project rollup counters — non-counter write paths', () => {
  it('leaves counts untouched when only the assignee changes', async () => {
    const t = setup();
    const projectId = await seedProject(t);
    const taskId = await seedTask(t, projectId, { status: 'todo' });
    const before = await counts(t, projectId);

    await asEditor(t).mutation(api.tasks.mutations.claimTask, { taskId });

    expect(await counts(t, projectId)).toEqual(before);
  });

  it('leaves counts untouched when only the title changes', async () => {
    const t = setup();
    const projectId = await seedProject(t);
    const taskId = await seedTask(t, projectId, { status: 'todo' });
    const before = await counts(t, projectId);

    await asEditor(t).mutation(api.tasks.mutations.updateTask, {
      taskId,
      title: 'Renamed',
    });

    expect(await counts(t, projectId)).toEqual(before);
  });
});

describe('recomputeProjectRollupCounts', () => {
  it('repairs drift and is a no-op on a second run', async () => {
    const t = setup();
    const projectId = await seedProject(t);
    await seedTask(t, projectId, { status: 'todo' });
    await seedTask(t, projectId, { status: 'in_review' });
    await seedTask(t, projectId, { status: 'done' });
    await seedTask(t, projectId, { status: 'cancelled' });
    await seedTask(t, projectId, { status: 'todo', archivedAt: 9 });
    // Deliberately wrong.
    await t.run((ctx) =>
      ctx.db.patch(projectId, {
        openTaskCount: 99,
        doneTaskCount: 0,
        projectAgentCount: 7,
      }),
    );

    const first = await t.mutation(
      internal.tasks.internal_mutations.recomputeProjectRollupCounts,
      { organizationId: ORG },
    );
    expect(first).toMatchObject({ scanned: 1, updated: 1 });
    expect(await counts(t, projectId)).toEqual({ open: 2, done: 1, agents: 0 });

    const second = await t.mutation(
      internal.tasks.internal_mutations.recomputeProjectRollupCounts,
      { organizationId: ORG },
    );
    expect(second).toMatchObject({ scanned: 1, updated: 0 });
  });
});
