/**
 * What the person carrying a task hears when it changes hands — including the
 * end-to-end version of the collapse promise: churn on one task's assignment
 * leaves ONE row telling the current truth, and churn that cancels itself leaves
 * none at all.
 */
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

const ORG = 'org_assignment_notify';
const LEAD = 'u_lead';
const WORKER = 'u_worker';
const OTHER = 'u_other';

type T = TestConvex<typeof schema>;

async function seedWorld(t: T): Promise<Id<'tasks'>> {
  return t.run(async (ctx) => {
    for (const userId of [LEAD, WORKER, OTHER]) {
      await ctx.db.insert('memberMirror', {
        memberId: `m_${userId}_${ORG}`,
        userId,
        organizationId: ORG,
        role: 'editor',
        createdAt: 0,
      });
    }
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Apollo',
      createdBy: LEAD,
      createdAt: 0,
      updatedAt: 0,
    });
    return ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 'Quarterly numbers',
      status: 'todo',
      rank: 'a0',
      createdBy: LEAD,
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
    });
  });
}

async function assign(
  t: T,
  taskId: Id<'tasks'>,
  assigneeId: string | undefined,
  as = LEAD,
): Promise<void> {
  await t
    .withIdentity({ subject: as })
    .mutation(api.tasks.mutations.assignTask, {
      taskId,
      ...(assigneeId !== undefined
        ? { assigneeType: 'user' as const, assigneeId }
        : {}),
    });
}

async function bellsFor(t: T, userId: string) {
  return t.run(async (ctx) =>
    (await ctx.db.query('userNotifications').collect()).filter(
      (row) => row.userId === userId,
    ),
  );
}

async function pendingJobs(t: T) {
  return t.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect()).filter(
      (job) => job.state.kind === 'pending',
    ),
  );
}

describe('losing the work', () => {
  it('tells the human it was taken from', async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedWorld(t);
    await assign(t, taskId, WORKER);
    // They read the assignment, so it is history now.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('userNotifications').collect()) {
        await ctx.db.patch(row._id, { read: true, readAt: 1 });
      }
    });

    await assign(t, taskId, OTHER);

    const bells = await bellsFor(t, WORKER);
    expect(bells.filter((row) => row.type === 'task_unassigned')).toHaveLength(
      1,
    );
    // The new owner hears about it too.
    expect(
      (await bellsFor(t, OTHER)).filter((row) => row.type === 'task_assigned'),
    ).toHaveLength(1);
  });

  it('says nothing when they handed it over themselves', async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedWorld(t);
    await assign(t, taskId, WORKER);
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('userNotifications').collect()) {
        await ctx.db.patch(row._id, { read: true, readAt: 1 });
      }
    });

    await assign(t, taskId, OTHER, WORKER);

    expect(
      (await bellsFor(t, WORKER)).filter(
        (row) => row.type === 'task_unassigned',
      ),
    ).toHaveLength(0);
  });

  it('leaves nothing behind when the assignment is undone unread', async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedWorld(t);

    await assign(t, taskId, WORKER);
    await assign(t, taskId, undefined);

    // They were never told they had it, so they are not told they lost it.
    expect(await bellsFor(t, WORKER)).toHaveLength(0);
    expect(await pendingJobs(t)).toHaveLength(0);
  });

  it('collapses a flurry into the current truth', async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedWorld(t);

    await assign(t, taskId, WORKER);
    await assign(t, taskId, undefined);
    await assign(t, taskId, WORKER);
    await assign(t, taskId, undefined);
    await assign(t, taskId, WORKER);

    const bells = await bellsFor(t, WORKER);
    expect(bells).toHaveLength(1);
    expect(bells[0]?.type).toBe('task_assigned');
    // One row, one email — not five of each.
    expect(await pendingJobs(t)).toHaveLength(1);
  });
});
