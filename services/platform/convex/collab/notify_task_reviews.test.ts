/**
 * `taskReview` is a safety signal (#2651): the settings UI locks the toggle
 * always-on, and the server must ignore any stored value — including a
 * `false` row persisted before that lock shipped — rather than honoring it.
 */
import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import type { Doc } from '../_generated/dataModel';
import schema from '../schema';
import { notifyTaskReviewResolved } from './notify_task_reviews';

const TEST_DIR_FROM_CONVEX_ROOT = 'collab';
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

const ORG = 'org_task_review_notify';
const DECIDER = 'user_decider';
const WATCHER = 'user_watcher';
type T = TestConvex<typeof schema>;

async function seedTask(t: T): Promise<Doc<'tasks'>> {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Roadmap',
      createdBy: DECIDER,
      createdAt: 0,
      updatedAt: 0,
    });
    const taskId = await ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 'Ship the fix',
      status: 'in_review',
      rank: 'a0',
      createdBy: 'user_agent',
      createdByType: 'agent',
      createdAt: 0,
      updatedAt: 0,
    });
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error('seeded task missing');
    return task;
  });
}

describe('notifyTaskReviewResolved', () => {
  it('still notifies a watcher who persisted a stale taskReview:false preference', async () => {
    const t = convexTest(schema, modules);
    const task = await seedTask(t);

    // A row written BEFORE the #2651 always-on lock shipped.
    await t.run(async (ctx) => {
      await ctx.db.insert('notificationPreferences', {
        userId: WATCHER,
        organizationId: ORG,
        taskReview: false,
        updatedAt: 0,
      });
    });

    await t.run(async (ctx) => {
      await notifyTaskReviewResolved(ctx, {
        task,
        decision: 'approve',
        decidedByUserId: DECIDER,
        recipientUserIds: [WATCHER],
      });
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('userNotifications')
        .withIndex('by_user_org_created', (q) =>
          q.eq('userId', WATCHER).eq('organizationId', ORG),
        )
        .collect(),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('task_review_resolved');
  });

  it('still notifies a watcher with no stored preference (default ON)', async () => {
    const t = convexTest(schema, modules);
    const task = await seedTask(t);

    await t.run(async (ctx) => {
      await notifyTaskReviewResolved(ctx, {
        task,
        decision: 'approve',
        decidedByUserId: DECIDER,
        recipientUserIds: [WATCHER],
      });
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('userNotifications')
        .withIndex('by_user_org_created', (q) =>
          q.eq('userId', WATCHER).eq('organizationId', ORG),
        )
        .collect(),
    );

    expect(rows).toHaveLength(1);
  });

  it('never notifies the deciding actor, regardless of their preference', async () => {
    const t = convexTest(schema, modules);
    const task = await seedTask(t);

    await t.run(async (ctx) => {
      await notifyTaskReviewResolved(ctx, {
        task,
        decision: 'approve',
        decidedByUserId: DECIDER,
        recipientUserIds: [DECIDER, WATCHER],
      });
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('userNotifications')
        .withIndex('by_user_org_created', (q) =>
          q.eq('userId', DECIDER).eq('organizationId', ORG),
        )
        .collect(),
    );

    expect(rows).toHaveLength(0);
  });
});
