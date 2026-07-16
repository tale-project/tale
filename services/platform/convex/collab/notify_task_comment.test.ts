/**
 * Comment-edit mention fan-out uses `notifyTaskComment` with
 * `notifySubscribers: false` so newly @mentioned humans get a mention row
 * without blasting other watchers as if a fresh comment were posted.
 */
import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import type { Doc } from '../_generated/dataModel';
import schema from '../schema';
import { notifyTaskComment } from './notify';

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

const ORG = 'org_task_comment_notify';
const AUTHOR = 'user_author';
const MENTIONED = 'user_mentioned';
const WATCHER = 'user_watcher';
type T = TestConvex<typeof schema>;

async function seedMember(t: T, userId: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}`,
      userId,
      organizationId: ORG,
      role: 'editor',
      createdAt: 0,
    });
  });
}

async function seedTaskWithWatcher(t: T): Promise<{
  task: Doc<'tasks'>;
  commentId: string;
}> {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Roadmap',
      createdBy: AUTHOR,
      createdAt: 0,
      updatedAt: 0,
    });
    const taskId = await ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 'Fix mentions',
      status: 'todo',
      rank: 'a0',
      createdBy: AUTHOR,
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
    });
    await ctx.db.insert('taskSubscriptions', {
      organizationId: ORG,
      taskId,
      subscriberType: 'user',
      subscriberId: WATCHER,
      reason: 'manual',
      createdAt: 0,
    });
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error('seeded task missing');
    return { task, commentId: 'msg_comment_edit' };
  });
}

describe('notifyTaskComment (comment-edit fan-out)', () => {
  it('with notifySubscribers:false notifies only newly mentioned humans', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, AUTHOR);
    await seedMember(t, MENTIONED);
    await seedMember(t, WATCHER);
    const { task, commentId } = await seedTaskWithWatcher(t);

    await t.run(async (ctx) => {
      await notifyTaskComment(ctx, {
        task,
        commentId,
        mentions: [{ type: 'user', id: MENTIONED }],
        actorType: 'user',
        actorId: AUTHOR,
        notifySubscribers: false,
      });
    });

    const mentionedRows = await t.run(async (ctx) =>
      ctx.db
        .query('userNotifications')
        .withIndex('by_user_org_created', (q) =>
          q.eq('userId', MENTIONED).eq('organizationId', ORG),
        )
        .collect(),
    );
    expect(mentionedRows).toHaveLength(1);
    expect(mentionedRows[0]).toMatchObject({
      type: 'mention',
      resourceType: 'comment',
      resourceId: commentId,
    });

    const watcherRows = await t.run(async (ctx) =>
      ctx.db
        .query('userNotifications')
        .withIndex('by_user_org_created', (q) =>
          q.eq('userId', WATCHER).eq('organizationId', ORG),
        )
        .collect(),
    );
    expect(watcherRows).toHaveLength(0);
  });

  it('defaults to notifying other subscribers on a fresh comment', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, AUTHOR);
    await seedMember(t, WATCHER);
    const { task, commentId } = await seedTaskWithWatcher(t);

    await t.run(async (ctx) => {
      await notifyTaskComment(ctx, {
        task,
        commentId,
        mentions: [],
        actorType: 'user',
        actorId: AUTHOR,
      });
    });

    const watcherRows = await t.run(async (ctx) =>
      ctx.db
        .query('userNotifications')
        .withIndex('by_user_org_created', (q) =>
          q.eq('userId', WATCHER).eq('organizationId', ORG),
        )
        .collect(),
    );
    expect(watcherRows).toHaveLength(1);
    expect(watcherRows[0]).toMatchObject({
      type: 'task_commented',
      resourceType: 'comment',
      resourceId: commentId,
    });
  });
});
