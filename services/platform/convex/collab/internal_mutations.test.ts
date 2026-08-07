/**
 * `taskReview` is a safety signal (#2651): automation-fired review reminders
 * and resolutions (`notifyFromAutomation`'s `isAllowed` gate, shared with
 * `notify.ts`) must ignore any stored `taskReview` value too, not just the
 * transactional emitters in `notify_task_reviews.ts`.
 */
import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
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

const ORG = 'org_automation_notify';
const RECIPIENT = 'user_recipient';
type T = TestConvex<typeof schema>;

async function seedStalePreference(
  t: T,
  userId: string,
  field: 'taskReview' | 'automationAlerts',
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('notificationPreferences', {
      userId,
      organizationId: ORG,
      [field]: false,
      updatedAt: 0,
    });
  });
}

describe('notifyFromAutomation', () => {
  it('still notifies for task_review_requested with a stale taskReview:false row', async () => {
    const t = convexTest(schema, modules);
    await seedStalePreference(t, RECIPIENT, 'taskReview');

    const result = await t.mutation(
      internal.collab.internal_mutations.notifyFromAutomation,
      {
        organizationId: ORG,
        audience: 'user_ids',
        userIds: [RECIPIENT],
        type: 'task_review_requested',
        titleKey: 'taskReviewReminder',
        bodyKey: 'taskReviewReminderBody',
      },
    );

    expect(result.notified).toBe(1);
  });

  it('still notifies for task_review_resolved with a stale taskReview:false row', async () => {
    const t = convexTest(schema, modules);
    await seedStalePreference(t, RECIPIENT, 'taskReview');

    const result = await t.mutation(
      internal.collab.internal_mutations.notifyFromAutomation,
      {
        organizationId: ORG,
        audience: 'user_ids',
        userIds: [RECIPIENT],
        type: 'task_review_resolved',
        titleKey: 'taskReviewApproved',
        bodyKey: 'taskReviewApprovedBody',
      },
    );

    expect(result.notified).toBe(1);
  });

  it('still honors a stored false for a normal (non-review) preference', async () => {
    const t = convexTest(schema, modules);
    await seedStalePreference(t, RECIPIENT, 'automationAlerts');

    const result = await t.mutation(
      internal.collab.internal_mutations.notifyFromAutomation,
      {
        organizationId: ORG,
        audience: 'user_ids',
        userIds: [RECIPIENT],
        type: 'automation_failed',
        titleKey: 'automationFailed',
        bodyKey: 'automationFailedBody',
      },
    );

    expect(result.notified).toBe(0);
  });
});

describe('notifyFromAutomation — conversation_assignee audience', () => {
  it('notifies the conversation owner when assigned', async () => {
    const t = convexTest(schema, modules);
    const conversationId = await t.run((ctx) =>
      ctx.db.insert('conversations', {
        organizationId: ORG,
        assigneeUserId: RECIPIENT,
        status: 'open',
      }),
    );

    const result = await t.mutation(
      internal.collab.internal_mutations.notifyFromAutomation,
      {
        organizationId: ORG,
        audience: 'conversation_assignee',
        conversationId,
        type: 'conversation_message',
        titleKey: 'conversationInboundMessage',
        bodyKey: 'conversationInboundMessageBody',
      },
    );

    expect(result.notified).toBe(1);
    const rows = await t.run((ctx) =>
      ctx.db
        .query('userNotifications')
        .withIndex('by_user_org_created', (q) =>
          q.eq('userId', RECIPIENT).eq('organizationId', ORG),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('conversation_message');
  });

  it('notifies no one when the conversation is unassigned (admin fallback is the workflow branch)', async () => {
    const t = convexTest(schema, modules);
    const conversationId = await t.run((ctx) =>
      ctx.db.insert('conversations', {
        organizationId: ORG,
        status: 'open',
      }),
    );

    const result = await t.mutation(
      internal.collab.internal_mutations.notifyFromAutomation,
      {
        organizationId: ORG,
        audience: 'conversation_assignee',
        conversationId,
        type: 'conversation_message',
        titleKey: 'conversationInboundMessage',
        bodyKey: 'conversationInboundMessageBody',
      },
    );

    expect(result.notified).toBe(0);
  });
});

describe('notifyFromAutomation — task_creator audience', () => {
  it('notifies the human task creator', async () => {
    const t = convexTest(schema, modules);
    const projectId = await t.run((ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Creator notify',
        createdBy: 'user_project',
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    const taskId = await t.run((ctx) =>
      ctx.db.insert('tasks', {
        organizationId: ORG,
        projectId,
        title: 'Unassigned work',
        status: 'todo',
        rank: 'a0',
        createdBy: RECIPIENT,
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
        statusChangedAt: 0,
      }),
    );

    const result = await t.mutation(
      internal.collab.internal_mutations.notifyFromAutomation,
      {
        organizationId: ORG,
        audience: 'task_creator',
        taskId,
        type: 'task_status_changed',
        titleKey: 'taskStartReached',
        bodyKey: 'taskStartReachedBody',
        params: { title: 'Unassigned work' },
      },
    );

    expect(result.notified).toBe(1);
    const rows = await t.run((ctx) =>
      ctx.db
        .query('userNotifications')
        .withIndex('by_user_org_created', (q) =>
          q.eq('userId', RECIPIENT).eq('organizationId', ORG),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.titleKey).toBe('taskStartReached');
  });

  it('notifies no one when the task was created by an agent', async () => {
    const t = convexTest(schema, modules);
    const projectId = await t.run((ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Agent created',
        createdBy: 'user_project',
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    const taskId = await t.run((ctx) =>
      ctx.db.insert('tasks', {
        organizationId: ORG,
        projectId,
        title: 'Agent work',
        status: 'todo',
        rank: 'a0',
        createdBy: 'agent_slug',
        createdByType: 'agent',
        createdAt: 0,
        updatedAt: 0,
        statusChangedAt: 0,
      }),
    );

    const result = await t.mutation(
      internal.collab.internal_mutations.notifyFromAutomation,
      {
        organizationId: ORG,
        audience: 'task_creator',
        taskId,
        type: 'task_status_changed',
        titleKey: 'taskDueSoon',
        bodyKey: 'taskDueSoonBody',
        params: { title: 'Agent work' },
      },
    );

    expect(result.notified).toBe(0);
  });
});
