/**
 * Collapse rules for personal notifications: one row per (person, thing,
 * dimension) while it is unread, one email carrying the state as it stands when
 * the debounce finally fires, and nothing at all when an event undoes an unread
 * one. Content-bearing rows (comments, mentions) must keep stacking.
 */
import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import schema from '../schema';
import {
  coalesceKeyFor,
  NOTIFICATION_EMAIL_DEBOUNCE_MS,
  writeCoalescedNotification,
} from './coalesce';

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

const ORG = 'org_coalesce';
const RECIPIENT = 'user_recipient';
type T = TestConvex<typeof schema>;

async function seedTask(t: T): Promise<Id<'tasks'>> {
  return t.run(async (ctx) => {
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Roadmap',
      createdBy: 'user_owner',
      createdAt: 0,
      updatedAt: 0,
    });
    return ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 'Quarterly numbers',
      status: 'todo',
      rank: 'a0',
      createdBy: 'user_owner',
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
    });
  });
}

async function rowsFor(t: T, userId = RECIPIENT) {
  return t.run(async (ctx) =>
    (await ctx.db.query('userNotifications').collect()).filter(
      (row) => row.userId === userId,
    ),
  );
}

async function pendingEmailJobs(t: T) {
  return t.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect()).filter(
      (job) => job.state.kind === 'pending',
    ),
  );
}

/** One assignment-dimension write for the seeded task. */
function assignment(
  taskId: Id<'tasks'>,
  variant: 'assigned' | 'unassigned',
): Parameters<typeof writeCoalescedNotification>[1] {
  return {
    userId: RECIPIENT,
    organizationId: ORG,
    type: variant === 'assigned' ? 'task_assigned' : 'task_unassigned',
    titleKey: variant === 'assigned' ? 'taskAssigned' : 'taskUnassigned',
    bodyKey: variant === 'assigned' ? 'taskAssignedBody' : 'taskUnassignedBody',
    params: { title: 'Quarterly numbers' },
    resourceType: 'task' as const,
    resourceId: String(taskId),
    taskId,
    actorType: 'user' as const,
    actorId: 'user_actor',
    ...(variant === 'unassigned' ? { undoes: true } : {}),
  };
}

describe('coalesceKeyFor', () => {
  it('shares one key across the types that describe a dimension', () => {
    const task = { resourceType: 'task' as const, resourceId: 'task_1' };
    expect(coalesceKeyFor({ type: 'task_assigned', ...task })).toBe(
      'task:task_1:assignment',
    );
    expect(coalesceKeyFor({ type: 'task_unassigned', ...task })).toBe(
      'task:task_1:assignment',
    );
    // A review request deep-links to its approval, the outcome to the task —
    // one gate either way, so one key.
    expect(
      coalesceKeyFor({
        type: 'task_review_requested',
        resourceType: 'task_review',
        resourceId: 'approval_1',
        taskId: 'task_1' as Id<'tasks'>,
      }),
    ).toBe('task:task_1:review');
    expect(coalesceKeyFor({ type: 'task_review_resolved', ...task })).toBe(
      'task:task_1:review',
    );
  });

  it('refuses to collapse content-bearing types', () => {
    const task = { resourceType: 'task' as const, resourceId: 'task_1' };
    expect(coalesceKeyFor({ type: 'mention', ...task })).toBeNull();
    expect(coalesceKeyFor({ type: 'task_commented', ...task })).toBeNull();
    expect(
      coalesceKeyFor({ type: 'conversation_message', ...task }),
    ).toBeNull();
  });

  it('keys conversations and documents on their own subject', () => {
    expect(
      coalesceKeyFor({
        type: 'conversation_assigned',
        resourceType: 'conversation',
        resourceId: 'conv_1',
      }),
    ).toBe('conversation:conv_1:assignment');
    expect(
      coalesceKeyFor({
        type: 'document_review_requested',
        resourceType: 'document_review',
        resourceId: 'approval_9',
        params: { documentId: 'doc_1' },
      }),
    ).toBe('document:doc_1:review');
  });
});

describe('writeCoalescedNotification', () => {
  it('rewrites the unread row instead of stacking a second one', async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedTask(t);

    await t.run((ctx) =>
      writeCoalescedNotification(ctx, assignment(taskId, 'assigned')),
    );
    await t.run((ctx) =>
      writeCoalescedNotification(ctx, {
        ...assignment(taskId, 'assigned'),
        actorId: 'user_second_actor',
      }),
    );

    const rows = await rowsFor(t);
    expect(rows).toHaveLength(1);
    // The surviving row tells the LATEST truth, not the first version.
    expect(rows[0]?.actorId).toBe('user_second_actor');
    expect(rows[0]?.coalesceKey).toBe(`task:${String(taskId)}:assignment`);
    // And exactly one email is still in flight for it.
    expect(await pendingEmailJobs(t)).toHaveLength(1);
  });

  it('drops both rows when an event undoes an unread one', async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedTask(t);

    await t.run((ctx) =>
      writeCoalescedNotification(ctx, assignment(taskId, 'assigned')),
    );
    const outcome = await t.run((ctx) =>
      writeCoalescedNotification(ctx, assignment(taskId, 'unassigned')),
    );

    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(await rowsFor(t)).toHaveLength(0);
    // Nothing was ever seen, so nothing is mailed.
    expect(await pendingEmailJobs(t)).toHaveLength(0);
  });

  it('survives a flurry as one row and one email', async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedTask(t);

    for (let i = 0; i < 4; i++) {
      await t.run((ctx) =>
        writeCoalescedNotification(ctx, assignment(taskId, 'assigned')),
      );
      await t.run((ctx) =>
        writeCoalescedNotification(ctx, assignment(taskId, 'unassigned')),
      );
    }
    await t.run((ctx) =>
      writeCoalescedNotification(ctx, assignment(taskId, 'assigned')),
    );

    const rows = await rowsFor(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('task_assigned');
    expect(await pendingEmailJobs(t)).toHaveLength(1);
  });

  it('never touches a row the person already read', async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedTask(t);
    await t.run((ctx) =>
      writeCoalescedNotification(ctx, assignment(taskId, 'assigned')),
    );
    const [seen] = await rowsFor(t);
    if (!seen) throw new Error('first row missing');
    await t.run((ctx) => ctx.db.patch(seen._id, { read: true, readAt: 1 }));

    await t.run((ctx) =>
      writeCoalescedNotification(ctx, assignment(taskId, 'unassigned')),
    );

    // History stays; the new state gets its own row.
    const rows = await rowsFor(t);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.read)).toHaveLength(1);
    expect(rows.find((row) => !row.read)?.type).toBe('task_unassigned');
  });

  it('stacks content-bearing rows — two comments are two notifications', async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedTask(t);
    const comment = (commentId: string) => ({
      userId: RECIPIENT,
      organizationId: ORG,
      type: 'task_commented' as const,
      titleKey: 'taskCommented',
      bodyKey: 'taskCommentedBody',
      resourceType: 'comment' as const,
      resourceId: commentId,
      taskId,
      actorType: 'user' as const,
      actorId: 'user_actor',
    });

    await t.run((ctx) => writeCoalescedNotification(ctx, comment('msg_1')));
    await t.run((ctx) => writeCoalescedNotification(ctx, comment('msg_2')));

    const rows = await rowsFor(t);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.coalesceKey === undefined)).toBe(true);
  });

  it('schedules the email with the debounce, not immediately', async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedTask(t);
    const before = Date.now();

    await t.run((ctx) =>
      writeCoalescedNotification(ctx, assignment(taskId, 'assigned')),
    );

    const [job] = await pendingEmailJobs(t);
    expect(job).toBeDefined();
    expect(job?.scheduledTime).toBeGreaterThanOrEqual(
      before + NOTIFICATION_EMAIL_DEBOUNCE_MS,
    );
    const [row] = await rowsFor(t);
    expect(row?.emailJobId).toBeDefined();
  });

  it('schedules no email for a bell-only type', async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedTask(t);

    await t.run((ctx) =>
      writeCoalescedNotification(ctx, {
        ...assignment(taskId, 'assigned'),
        type: 'task_status_changed',
        titleKey: 'taskStatusChanged',
        bodyKey: 'taskStatusChangedBody',
      }),
    );

    expect(await rowsFor(t)).toHaveLength(1);
    expect(await pendingEmailJobs(t)).toHaveLength(0);
  });

  it('keeps two recipients independent', async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedTask(t);

    await t.run((ctx) =>
      writeCoalescedNotification(ctx, assignment(taskId, 'assigned')),
    );
    await t.run((ctx) =>
      writeCoalescedNotification(ctx, {
        ...assignment(taskId, 'assigned'),
        userId: 'user_other',
      }),
    );

    expect(await rowsFor(t)).toHaveLength(1);
    expect(await rowsFor(t, 'user_other')).toHaveLength(1);
  });

  it('keeps two tasks independent', async () => {
    const t = convexTest(schema, modules);
    const first = await seedTask(t);
    const second = await seedTask(t);

    await t.run((ctx) =>
      writeCoalescedNotification(ctx, assignment(first, 'assigned')),
    );
    await t.run((ctx) =>
      writeCoalescedNotification(ctx, assignment(second, 'assigned')),
    );

    const rows: Doc<'userNotifications'>[] = await rowsFor(t);
    expect(rows).toHaveLength(2);
  });
});
