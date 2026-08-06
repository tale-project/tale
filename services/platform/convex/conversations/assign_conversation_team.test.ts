// Drives the REAL `assignConversationTeam` mutationWithRLS (admin gate via the
// member mirror, team-in-org validation via the Better Auth `team` component,
// the assigneeTeamId patch, audit, and the scheduled raw-ctx team notify) plus
// the `notifyAssignedTeam` internal mutation it schedules. Mirrors
// assign_conversation.test.ts; registers the real betterAuth component so the
// team-in-org lookup runs, not a stub.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, components, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import betterAuthSchema from '../betterAuth/schema';
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
const authModules = import.meta.glob('../betterAuth/**/*.*s');

const ORG = 'org_assign_team';
const OTHER_ORG = 'org_assign_team_other';
const ADMIN = 'user_team_admin';
const EDITOR = 'user_team_editor';
const OUTSIDER = 'user_team_outsider';
const TEAM_MEMBER_A = 'user_team_member_a';
const TEAM_MEMBER_B = 'user_team_member_b';
type T = TestConvex<typeof schema>;

function newWorld(): T {
  const t = convexTest(schema, modules);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  return t;
}

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

async function seedTeam(t: T, organizationId: string): Promise<string> {
  return t.run(async (ctx) => {
    const created = await ctx.runMutation(
      components.betterAuth.adapter.create,
      {
        input: {
          model: 'team',
          data: {
            name: `Team ${organizationId}`,
            organizationId,
            createdAt: 0,
            updatedAt: 0,
          },
        },
      },
    );
    const record = created as { _id?: string; id?: string };
    return String(record._id ?? record.id);
  });
}

async function seedTeamMemberMirror(
  t: T,
  teamId: string,
  userId: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('teamMemberMirror', {
      teamMemberId: `tm_${teamId}_${userId}`,
      teamId,
      userId,
      createdAt: 0,
    });
  });
}

async function seedConversation(
  t: T,
  organizationId: string,
  opts: { assigneeTeamId?: string; subject?: string } = {},
): Promise<Id<'conversations'>> {
  return t.run((ctx) =>
    ctx.db.insert('conversations', {
      organizationId,
      subject: opts.subject ?? 'Help please',
      status: 'open',
      channel: 'email',
      direction: 'inbound',
      ...(opts.assigneeTeamId ? { assigneeTeamId: opts.assigneeTeamId } : {}),
    }),
  );
}

async function scheduledTeamNotifyJobs(t: T) {
  const scheduled = await t.run((ctx) =>
    ctx.db.system.query('_scheduled_functions').collect(),
  );
  return scheduled.filter((job) => job.name.includes('notifyAssignedTeam'));
}

describe('assignConversationTeam', () => {
  it('an admin queues an in-org team: patches assigneeTeamId and schedules the team notify', async () => {
    const t = newWorld();
    await seedMember(t, ADMIN, ORG, 'admin');
    const teamId = await seedTeam(t, ORG);
    const conversationId = await seedConversation(t, ORG);

    await t
      .withIdentity({ subject: ADMIN })
      .mutation(api.conversations.mutations.assignConversationTeam, {
        conversationId,
        assigneeTeamId: teamId,
      });

    const conv = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conv?.assigneeTeamId).toBe(teamId);

    const jobs = await scheduledTeamNotifyJobs(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].args[0]).toMatchObject({
      conversationId,
      assigneeTeamId: teamId,
      actorUserId: ADMIN,
    });
  });

  it('rejects a team from another organization (team-in-org) and leaves the field unchanged', async () => {
    const t = newWorld();
    await seedMember(t, ADMIN, ORG, 'admin');
    const foreignTeamId = await seedTeam(t, OTHER_ORG);
    const conversationId = await seedConversation(t, ORG);

    const error: unknown = await t
      .withIdentity({ subject: ADMIN })
      .mutation(api.conversations.mutations.assignConversationTeam, {
        conversationId,
        assigneeTeamId: foreignTeamId,
      })
      .catch((e: unknown) => e);

    expect(String(error)).toMatch(/team_not_in_org|organization/i);
    const conv = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conv?.assigneeTeamId).toBeUndefined();
    expect(await scheduledTeamNotifyJobs(t)).toHaveLength(0);
  });

  it('rejects a non-admin caller and leaves the team unchanged', async () => {
    const t = newWorld();
    await seedMember(t, EDITOR, ORG, 'editor');
    const teamId = await seedTeam(t, ORG);
    await seedTeamMemberMirror(t, teamId, EDITOR);
    // Queue to the editor's team so RLS lets them read the row; the admin
    // gate still rejects the reassignment.
    const conversationId = await seedConversation(t, ORG, {
      assigneeTeamId: teamId,
    });

    const error: unknown = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.conversations.mutations.assignConversationTeam, {
        conversationId,
        assigneeTeamId: teamId,
      })
      .catch((e: unknown) => e);

    expect(String(error)).toMatch(/admin/i);
    const conv = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conv?.assigneeTeamId).toBe(teamId);
    expect(await scheduledTeamNotifyJobs(t)).toHaveLength(0);
  });

  it('un-queues (omitting assigneeTeamId) and schedules no notify', async () => {
    const t = newWorld();
    await seedMember(t, ADMIN, ORG, 'admin');
    const teamId = await seedTeam(t, ORG);
    const conversationId = await seedConversation(t, ORG, {
      assigneeTeamId: teamId,
    });

    await t
      .withIdentity({ subject: ADMIN })
      .mutation(api.conversations.mutations.assignConversationTeam, {
        conversationId,
      });

    const conv = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conv?.assigneeTeamId).toBeUndefined();
    expect(await scheduledTeamNotifyJobs(t)).toHaveLength(0);
  });

  it('is a no-op when the team is unchanged (no notify)', async () => {
    const t = newWorld();
    await seedMember(t, ADMIN, ORG, 'admin');
    const teamId = await seedTeam(t, ORG);
    const conversationId = await seedConversation(t, ORG, {
      assigneeTeamId: teamId,
    });

    await t
      .withIdentity({ subject: ADMIN })
      .mutation(api.conversations.mutations.assignConversationTeam, {
        conversationId,
        assigneeTeamId: teamId,
      });

    expect(await scheduledTeamNotifyJobs(t)).toHaveLength(0);
  });

  it('denies a caller from another organization (RLS)', async () => {
    const t = newWorld();
    await seedMember(t, OUTSIDER, OTHER_ORG, 'admin');
    const teamId = await seedTeam(t, OTHER_ORG);
    const conversationId = await seedConversation(t, ORG);

    await expect(
      t
        .withIdentity({ subject: OUTSIDER })
        .mutation(api.conversations.mutations.assignConversationTeam, {
          conversationId,
          assigneeTeamId: teamId,
        }),
    ).rejects.toThrow();
    const conv = await t.run((ctx) => ctx.db.get(conversationId));
    expect(conv?.assigneeTeamId).toBeUndefined();
  });
});

describe('notifyAssignedTeam', () => {
  it('fans out one conversation_assigned row per team member, excluding the actor', async () => {
    const t = newWorld();
    const teamId = await seedTeam(t, ORG);
    await seedTeamMemberMirror(t, teamId, ADMIN); // actor — excluded
    await seedTeamMemberMirror(t, teamId, TEAM_MEMBER_A);
    await seedTeamMemberMirror(t, teamId, TEAM_MEMBER_B);
    const conversationId = await seedConversation(t, ORG, {
      assigneeTeamId: teamId,
      subject: 'Broken widget',
    });

    await t.mutation(
      internal.conversations.internal_mutations.notifyAssignedTeam,
      { conversationId, assigneeTeamId: teamId, actorUserId: ADMIN },
    );

    const rows = await t.run((ctx) =>
      ctx.db.query('userNotifications').collect(),
    );
    const recipients = rows
      .filter((n) => n.type === 'conversation_assigned')
      .map((n) => n.userId)
      .sort();
    expect(recipients).toEqual([TEAM_MEMBER_A, TEAM_MEMBER_B].sort());
    const sample = rows.find((n) => n.userId === TEAM_MEMBER_A);
    expect(sample?.resourceType).toBe('conversation');
    expect(sample?.resourceId).toBe(conversationId);
    expect(sample?.params).toMatchObject({
      conversationId,
      conversationStatus: 'open',
      subject: 'Broken widget',
    });
  });

  it('de-dupes a user present in more than one membership row', async () => {
    const t = newWorld();
    const teamId = await seedTeam(t, ORG);
    await seedTeamMemberMirror(t, teamId, TEAM_MEMBER_A);
    await seedTeamMemberMirror(t, teamId, TEAM_MEMBER_A); // duplicate edge
    const conversationId = await seedConversation(t, ORG, {
      assigneeTeamId: teamId,
    });

    await t.mutation(
      internal.conversations.internal_mutations.notifyAssignedTeam,
      { conversationId, assigneeTeamId: teamId, actorUserId: ADMIN },
    );

    const rows = await t.run((ctx) =>
      ctx.db.query('userNotifications').collect(),
    );
    expect(rows.filter((n) => n.userId === TEAM_MEMBER_A)).toHaveLength(1);
  });
});
