import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

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

const ORG = 'org_attention_test';
const USER = 'user_reviewer';
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

async function seedProject(t: T): Promise<Id<'projects'>> {
  return await t.run((ctx) =>
    ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Roadmap',
      createdBy: USER,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

describe('getMyAttentionSummary', () => {
  it('counts unread actionable notifications, pending reviews, and assigned tasks', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, USER);
    const projectId = await seedProject(t);

    const reviewTaskId = await t.run(async (ctx) => {
      const taskId = await ctx.db.insert('tasks', {
        organizationId: ORG,
        projectId,
        title: 'Review me',
        status: 'in_review',
        rank: 'a0',
        createdBy: 'user_agent',
        createdByType: 'agent',
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert('approvals', {
        organizationId: ORG,
        status: 'pending',
        resourceType: 'task_review',
        resourceId: taskId,
        priority: 'medium',
        metadata: { requestedFor: USER, taskId },
      });
      return taskId;
    });

    const assignedTaskId = await t.run(async (ctx) =>
      ctx.db.insert('tasks', {
        organizationId: ORG,
        projectId,
        title: 'Assigned to me',
        status: 'in_progress',
        rank: 'a1',
        assigneeType: 'user',
        assigneeId: USER,
        createdBy: USER,
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
      }),
    );

    await t.run(async (ctx) => {
      await ctx.db.insert('userNotifications', {
        userId: USER,
        organizationId: ORG,
        type: 'task_review_requested',
        titleKey: 'review.title',
        bodyKey: 'review.body',
        resourceType: 'task_review',
        resourceId: String(reviewTaskId),
        taskId: reviewTaskId,
        actorType: 'system',
        read: false,
        createdAt: 1,
      });
      await ctx.db.insert('userNotifications', {
        userId: USER,
        organizationId: ORG,
        type: 'task_status_changed',
        titleKey: 'status.title',
        bodyKey: 'status.body',
        resourceType: 'task',
        resourceId: String(assignedTaskId),
        taskId: assignedTaskId,
        actorType: 'user',
        actorId: 'user_other',
        read: false,
        createdAt: 2,
      });
    });

    const summary = await t
      .withIdentity({ subject: USER })
      .query(api.collab.attention.getMyAttentionSummary, {
        organizationId: ORG,
      });

    expect(summary.unreadActionableCount).toBe(1);
    expect(summary.unreadTotalCount).toBe(2);
    expect(summary.pendingReviewCount).toBe(1);
    expect(summary.waitingOnMeTaskIds.sort()).toEqual(
      [reviewTaskId, assignedTaskId].sort(),
    );
  });

  it('scopes waiting-on-me tasks to a project when projectId is passed', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, USER);
    const projectA = await seedProject(t);
    const projectB = await t.run((ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Other',
        createdBy: USER,
        createdAt: 0,
        updatedAt: 0,
      }),
    );

    await t.run(async (ctx) => {
      await ctx.db.insert('tasks', {
        organizationId: ORG,
        projectId: projectA,
        title: 'In A',
        status: 'todo',
        rank: 'a0',
        assigneeType: 'user',
        assigneeId: USER,
        createdBy: USER,
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert('tasks', {
        organizationId: ORG,
        projectId: projectB,
        title: 'In B',
        status: 'todo',
        rank: 'a0',
        assigneeType: 'user',
        assigneeId: USER,
        createdBy: USER,
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
      });
    });

    const summary = await t
      .withIdentity({ subject: USER })
      .query(api.collab.attention.getMyAttentionSummary, {
        organizationId: ORG,
        projectId: projectA,
      });

    expect(summary.waitingOnMeTaskIds).toHaveLength(1);
  });
});
