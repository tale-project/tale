// Drives the REAL `assignConversation` mutationWithRLS (admin gate via the
// member mirror, assignee patch, audit, and the scheduled raw-ctx notify) plus
// the `notifyAssigned` internal mutation it schedules. Module map keyed relative
// to the convex/ root, mirroring compose_email_conversation.test.ts.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'conversations';
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

const ORG = 'org_assign';
const OTHER_ORG = 'org_assign_other';
const ADMIN = 'user_assign_admin';
const MEMBER = 'user_assign_member';
const EDITOR = 'user_assign_editor';
const OUTSIDER = 'user_assign_outsider';
type T = TestConvex<typeof schema>;

async function seedMember(
  t: T,
  userId: string,
  organizationId: string,
  role: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}`,
      userId,
      organizationId,
      role,
      createdAt: 0,
    });
  });
}

async function seedConversation(
  t: T,
  organizationId: string,
  opts: { assigneeUserId?: string; subject?: string } = {},
): Promise<Id<'conversations'>> {
  return t.run((ctx) =>
    ctx.db.insert('conversations', {
      organizationId,
      subject: opts.subject ?? 'Help please',
      status: 'open',
      channel: 'email',
      direction: 'inbound',
      ...(opts.assigneeUserId ? { assigneeUserId: opts.assigneeUserId } : {}),
    }),
  );
}

async function scheduledNotifyJobs(t: T) {
  const scheduled = await t.run((ctx) =>
    ctx.db.system.query('_scheduled_functions').collect(),
  );
  return scheduled.filter((job) => job.name.includes('notifyAssigned'));
}

describe('assignConversation', () => {
  it('an admin assigns a member: patches the assignee and schedules the notify', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ADMIN, ORG, 'admin');
    await seedMember(t, MEMBER, ORG, 'editor');
    const conversationId = await seedConversation(t, ORG);

    await t
      .withIdentity({ subject: ADMIN })
      .mutation(api.conversations.mutations.assignConversation, {
        conversationId,
        assigneeUserId: MEMBER,
      });

    const conv = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conv?.assigneeUserId).toBe(MEMBER);

    const jobs = await scheduledNotifyJobs(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].args[0]).toMatchObject({
      conversationId,
      assigneeUserId: MEMBER,
      actorUserId: ADMIN,
    });
  });

  it('notifyAssigned writes a conversation_assigned row (deep-link params) for the new assignee', async () => {
    const t = convexTest(schema, modules);
    const conversationId = await seedConversation(t, ORG, {
      assigneeUserId: MEMBER,
      subject: 'Broken widget',
    });

    await t.mutation(internal.conversations.internal_mutations.notifyAssigned, {
      conversationId,
      assigneeUserId: MEMBER,
      actorUserId: ADMIN,
    });

    const rows = await t.run((ctx) =>
      ctx.db.query('userNotifications').collect(),
    );
    const row = rows.find(
      (n) => n.userId === MEMBER && n.type === 'conversation_assigned',
    );
    expect(row).toBeTruthy();
    expect(row?.resourceType).toBe('conversation');
    expect(row?.resourceId).toBe(conversationId);
    expect(row?.params).toMatchObject({
      conversationId,
      conversationStatus: 'open',
      subject: 'Broken widget',
    });
  });

  it('notifyAssigned self-skips when the actor is the assignee', async () => {
    const t = convexTest(schema, modules);
    const conversationId = await seedConversation(t, ORG, {
      assigneeUserId: MEMBER,
    });

    await t.mutation(internal.conversations.internal_mutations.notifyAssigned, {
      conversationId,
      assigneeUserId: MEMBER,
      actorUserId: MEMBER,
    });

    const rows = await t.run((ctx) =>
      ctx.db.query('userNotifications').collect(),
    );
    expect(rows).toHaveLength(0);
  });

  it('rejects a non-admin caller and leaves the assignee unchanged', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, EDITOR, ORG, 'editor');
    // Seed as already assigned to the editor so RLS lets them read the row;
    // the admin gate still rejects the reassignment.
    const conversationId = await seedConversation(t, ORG, {
      assigneeUserId: EDITOR,
    });

    const error: unknown = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.assignConversation, {
        conversationId,
        assigneeUserId: MEMBER,
      })
      .catch((e: unknown) => e);

    expect(String(error)).toMatch(/admin/i);
    const conv = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conv?.assigneeUserId).toBe(EDITOR);
    expect(await scheduledNotifyJobs(t)).toHaveLength(0);
  });

  it('does not schedule a notify when an admin assigns themselves', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ADMIN, ORG, 'admin');
    const conversationId = await seedConversation(t, ORG);

    await t
      .withIdentity({ subject: ADMIN })
      .mutation(api.conversations.mutations.assignConversation, {
        conversationId,
        assigneeUserId: ADMIN,
      });

    const conv = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conv?.assigneeUserId).toBe(ADMIN);
    expect(await scheduledNotifyJobs(t)).toHaveLength(0);
  });

  it('unassigns (omitting assigneeUserId) and schedules no notify', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ADMIN, ORG, 'admin');
    const conversationId = await seedConversation(t, ORG, {
      assigneeUserId: MEMBER,
    });

    await t
      .withIdentity({ subject: ADMIN })
      .mutation(api.conversations.mutations.assignConversation, {
        conversationId,
      });

    const conv = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conv?.assigneeUserId).toBeUndefined();
    expect(await scheduledNotifyJobs(t)).toHaveLength(0);
  });

  it('is a no-op when the assignee is unchanged (no notify)', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ADMIN, ORG, 'admin');
    const conversationId = await seedConversation(t, ORG, {
      assigneeUserId: MEMBER,
    });

    await t
      .withIdentity({ subject: ADMIN })
      .mutation(api.conversations.mutations.assignConversation, {
        conversationId,
        assigneeUserId: MEMBER,
      });

    expect(await scheduledNotifyJobs(t)).toHaveLength(0);
  });

  it('denies a caller from another organization (RLS)', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, OUTSIDER, OTHER_ORG, 'admin');
    const conversationId = await seedConversation(t, ORG);

    await expect(
      t
        .withIdentity({ subject: OUTSIDER })
        .mutation(api.conversations.mutations.assignConversation, {
          conversationId,
          assigneeUserId: OUTSIDER,
        }),
    ).rejects.toThrow();
    const conv = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conv?.assigneeUserId).toBeUndefined();
  });
});
