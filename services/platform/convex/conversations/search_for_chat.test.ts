// Drives the REAL chat conversations leg through convex-test, so the privacy
// claim is proven end to end rather than at the predicate alone. The leg reads
// through an RLS-BYPASSING internal query, which is exactly why this exists:
// nothing upstream of it enforces assignment privacy, so if the leg gets it
// wrong the whole inbox is published to any member.
//
// Seeds the local mirrors (memberMirror / teamMemberMirror) directly, the same
// way `conversation_access_rls.test.ts` does, so no Better Auth component is
// needed.

import { convexTest, type TestConvex } from 'convex-test';
import { beforeEach, describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
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

const ORG = 'org_chat_conv_leg';
const TEAM_X = 'team_x_chat_leg';
const ADMIN = 'user_chat_leg_admin';
const TEAM_MEMBER = 'user_chat_leg_team';
const OWNER_USER = 'user_chat_leg_owner';
const PLAIN_MEMBER = 'user_chat_leg_plain';
type T = TestConvex<typeof schema>;

async function seedWorld(t: T): Promise<void> {
  await t.run(async (ctx) => {
    for (const [userId, role] of [
      [ADMIN, 'admin'],
      [TEAM_MEMBER, 'member'],
      [OWNER_USER, 'member'],
      [PLAIN_MEMBER, 'member'],
    ] as const) {
      await ctx.db.insert('memberMirror', {
        memberId: `m_${userId}`,
        userId,
        organizationId: ORG,
        role,
        createdAt: 0,
      });
    }
    await ctx.db.insert('teamMemberMirror', {
      teamMemberId: `tm_${TEAM_X}_${TEAM_MEMBER}`,
      teamId: TEAM_X,
      userId: TEAM_MEMBER,
      createdAt: 0,
    });
    // Every subject shares the word "refund", so the text match is never what
    // distinguishes these rows — only the assignment scope is.
    await ctx.db.insert('conversations', {
      organizationId: ORG,
      subject: 'Refund pool unassigned',
      status: 'open',
      lastMessageAt: 400,
    });
    await ctx.db.insert('conversations', {
      organizationId: ORG,
      subject: 'Refund queued to team X',
      status: 'open',
      assigneeTeamId: TEAM_X,
      lastMessageAt: 300,
    });
    await ctx.db.insert('conversations', {
      organizationId: ORG,
      subject: 'Refund owned by a person',
      status: 'open',
      assigneeUserId: OWNER_USER,
      lastMessageAt: 200,
    });
  });
}

async function subjectsFor(t: T, userId: string): Promise<string[]> {
  const result = await t.query(
    internal.conversations.search_for_chat.searchConversationsForChat,
    { organizationId: ORG, userId, term: 'refund', limit: 10 },
  );
  return result.conversations.map((c) => c.subject ?? '').sort();
}

describe('searchConversationsForChat — assignment privacy', () => {
  let t: T;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    await seedWorld(t);
  });

  // THE test. An unassigned conversation is admin-triage state, and a member
  // who is on no team and owns nothing must come back empty — not with the
  // inbox.
  it('shows a plain member nothing', async () => {
    expect(await subjectsFor(t, PLAIN_MEMBER)).toEqual([]);
  });

  it('shows an admin every matching conversation, unassigned included', async () => {
    expect(await subjectsFor(t, ADMIN)).toEqual([
      'Refund owned by a person',
      'Refund pool unassigned',
      'Refund queued to team X',
    ]);
  });

  it('shows the individual assignee only their own', async () => {
    expect(await subjectsFor(t, OWNER_USER)).toEqual([
      'Refund owned by a person',
    ]);
  });

  it("shows a team member only their team's", async () => {
    expect(await subjectsFor(t, TEAM_MEMBER)).toEqual([
      'Refund queued to team X',
    ]);
  });

  // NOT covered here: a user with no membership at all. `resolveAgentReadAccess`
  // falls back to the Better Auth component when no `memberMirror` row exists,
  // and that component is not registered in convex-test. The not-a-member
  // refusal is exercised by the access resolver's own tests; this file proves
  // the scope rules that only this leg can get wrong.

  it('does not reach into another organization', async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert('conversations', {
        organizationId: 'some_other_org',
        subject: 'Refund in a foreign org',
        status: 'open',
        assigneeUserId: ADMIN,
        lastMessageAt: 500,
      });
    });
    expect(await subjectsFor(t, ADMIN)).not.toContain(
      'Refund in a foreign org',
    );
  });

  it('finds a conversation by its contact name, not only its subject', async () => {
    await t.run(async (ctx) => {
      const contactId = await ctx.db.insert('contacts', {
        organizationId: ORG,
        name: 'Wilhelmina Baker',
        source: 'manual_import',
      });
      await ctx.db.insert('conversations', {
        organizationId: ORG,
        subject: 'A subject sharing no words with the query',
        status: 'open',
        assigneeUserId: OWNER_USER,
        contactId,
        lastMessageAt: 600,
      });
    });
    const result = await t.query(
      internal.conversations.search_for_chat.searchConversationsForChat,
      {
        organizationId: ORG,
        userId: OWNER_USER,
        term: 'wilhelmina',
        limit: 10,
      },
    );
    expect(result.conversations.map((c) => c.subject)).toContain(
      'A subject sharing no words with the query',
    );
  });

  it('still applies assignment scope to a contact-name match', async () => {
    await t.run(async (ctx) => {
      const contactId = await ctx.db.insert('contacts', {
        organizationId: ORG,
        name: 'Wilhelmina Baker',
        source: 'manual_import',
      });
      // Unassigned: findable by contact name for an admin, invisible to a
      // plain member. The contact match must not become a second way in.
      await ctx.db.insert('conversations', {
        organizationId: ORG,
        subject: 'Unassigned but contact matches',
        status: 'open',
        contactId,
        lastMessageAt: 700,
      });
    });
    const plain = await t.query(
      internal.conversations.search_for_chat.searchConversationsForChat,
      {
        organizationId: ORG,
        userId: PLAIN_MEMBER,
        term: 'wilhelmina',
        limit: 10,
      },
    );
    expect(plain.conversations).toEqual([]);
  });
});

describe('searchConversationsForChat — the assignment is returned', () => {
  let t: T;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    await seedWorld(t);
  });

  // Observed in production: asked "what team is this assigned to", chat could
  // find the conversation and could not say. The assignment is the field this
  // leg's whole privacy rule is built on, and it was withheld from the answer.
  it('names the team a conversation is queued to', async () => {
    const result = await t.query(
      internal.conversations.search_for_chat.searchConversationsForChat,
      { organizationId: ORG, userId: ADMIN, term: 'refund', limit: 10 },
    );
    const queued = result.conversations.find(
      (c) => c.subject === 'Refund queued to team X',
    );
    expect(queued?.assigneeTeamId).toBe(TEAM_X);
    expect(queued?.assigneeUserId).toBeUndefined();
  });

  it('names the person a conversation is owned by', async () => {
    const result = await t.query(
      internal.conversations.search_for_chat.searchConversationsForChat,
      { organizationId: ORG, userId: ADMIN, term: 'refund', limit: 10 },
    );
    const owned = result.conversations.find(
      (c) => c.subject === 'Refund owned by a person',
    );
    expect(owned?.assigneeUserId).toBe(OWNER_USER);
  });

  it('returns neither field for an unassigned conversation', async () => {
    const result = await t.query(
      internal.conversations.search_for_chat.searchConversationsForChat,
      { organizationId: ORG, userId: ADMIN, term: 'refund', limit: 10 },
    );
    const pool = result.conversations.find(
      (c) => c.subject === 'Refund pool unassigned',
    );
    expect(pool).toBeDefined();
    expect(pool?.assigneeUserId).toBeUndefined();
    expect(pool?.assigneeTeamId).toBeUndefined();
  });
});
