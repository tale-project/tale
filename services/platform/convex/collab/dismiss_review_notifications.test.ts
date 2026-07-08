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

const ORG = 'org_dismiss_review_test';
const REVIEWER = 'user_reviewer';
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

async function seedReviewFixture(t: T): Promise<{
  taskId: Id<'tasks'>;
  approvalId: Id<'approvals'>;
  initialNotificationId: Id<'userNotifications'>;
  reminderNotificationId: Id<'userNotifications'>;
}> {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Roadmap',
      createdBy: REVIEWER,
      createdAt: 0,
      updatedAt: 0,
    });
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
    const approvalId = await ctx.db.insert('approvals', {
      organizationId: ORG,
      status: 'pending',
      resourceType: 'task_review',
      resourceId: taskId,
      priority: 'high',
      metadata: { requestedFor: REVIEWER, taskId: String(taskId) },
    });

    const initialNotificationId = await ctx.db.insert('userNotifications', {
      userId: REVIEWER,
      organizationId: ORG,
      type: 'task_review_requested',
      titleKey: 'taskReviewRequested',
      bodyKey: 'taskReviewRequestedBody',
      params: {
        approvalId: String(approvalId),
        taskId: String(taskId),
        taskTitle: 'Review me',
      },
      resourceType: 'task_review',
      resourceId: String(approvalId),
      taskId,
      actorType: 'agent',
      read: false,
      createdAt: 1,
    });

    const reminderNotificationId = await ctx.db.insert('userNotifications', {
      userId: REVIEWER,
      organizationId: ORG,
      type: 'task_review_requested',
      titleKey: 'taskReviewReminder',
      bodyKey: 'taskReviewReminderBody',
      params: {
        approvalId: String(approvalId),
        taskId: String(taskId),
        taskTitle: 'Review me',
      },
      resourceType: 'task_review',
      resourceId: String(taskId),
      taskId,
      actorType: 'system',
      read: false,
      createdAt: 2,
    });

    return {
      taskId,
      approvalId,
      initialNotificationId,
      reminderNotificationId,
    };
  });
}

describe('dismissReviewRequestNotifications via respondToTaskReview', () => {
  it('marks stacked initial and reminder review rows read and drops actionable count', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, REVIEWER);
    const { approvalId, initialNotificationId, reminderNotificationId } =
      await seedReviewFixture(t);

    const asReviewer = t.withIdentity({ subject: REVIEWER });

    const before = await asReviewer.query(
      api.collab.attention.getMyAttentionSummary,
      { organizationId: ORG },
    );
    expect(before.unreadActionableCount).toBe(2);

    await asReviewer.mutation(api.tasks.review_mutations.respondToTaskReview, {
      approvalId,
      decision: 'approve',
    });

    const after = await asReviewer.query(
      api.collab.attention.getMyAttentionSummary,
      { organizationId: ORG },
    );
    expect(after.unreadActionableCount).toBe(0);
    expect(after.pendingReviewCount).toBe(0);

    const rows = await t.run(async (ctx) => {
      const initial = await ctx.db.get(initialNotificationId);
      const reminder = await ctx.db.get(reminderNotificationId);
      return { initial, reminder };
    });
    expect(rows.initial?.read).toBe(true);
    expect(rows.initial?.readAt).toBeTypeOf('number');
    expect(rows.reminder?.read).toBe(true);
    expect(rows.reminder?.readAt).toBeTypeOf('number');
  });
});
