// Drives the REAL conversations RLS read rules (queryWithRLS + rls_rules.ts)
// through convex-test to prove built-in assignment privacy: a conversation is
// visible only to admins, to its individual owner, or to a member of its queued
// team. True unassigned (neither person nor team) is admin triage only — not an
// org-wide Member pool. Seeds the local mirrors (memberMirror / teamMemberMirror)
// directly, so no Better Auth component is needed. A leftover
// `conversation_access` configCache row is ignored.

import { convexTest, type TestConvex } from 'convex-test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
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

const ORG = 'org_access_rls';
const TEAM_X = 'team_x_access';
const TEAM_Y = 'team_y_access';
const ADMIN = 'user_access_admin';
const TEAM_MEMBER = 'user_access_team_member';
const OWNER_USER = 'user_access_owner';
const PLAIN_MEMBER = 'user_access_plain';
type T = TestConvex<typeof schema>;

interface Seeded {
  unassigned: Id<'conversations'>;
  teamX: Id<'conversations'>;
  owned: Id<'conversations'>;
  teamY: Id<'conversations'>;
}

async function seedWorld(t: T): Promise<Seeded> {
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
    // TEAM_MEMBER belongs to TEAM_X; no one belongs to TEAM_Y.
    await ctx.db.insert('teamMemberMirror', {
      teamMemberId: `tm_${TEAM_X}_${TEAM_MEMBER}`,
      teamId: TEAM_X,
      userId: TEAM_MEMBER,
      createdAt: 0,
    });
  });
  return t.run(async (ctx) => ({
    unassigned: await ctx.db.insert('conversations', {
      organizationId: ORG,
      subject: 'Unassigned pool',
      status: 'open',
    }),
    teamX: await ctx.db.insert('conversations', {
      organizationId: ORG,
      subject: 'Queued to Team X',
      status: 'open',
      assigneeTeamId: TEAM_X,
    }),
    owned: await ctx.db.insert('conversations', {
      organizationId: ORG,
      subject: 'Owned by a person',
      status: 'open',
      assigneeUserId: OWNER_USER,
    }),
    teamY: await ctx.db.insert('conversations', {
      organizationId: ORG,
      subject: 'Queued to Team Y',
      status: 'open',
      assigneeTeamId: TEAM_Y,
    }),
  }));
}

async function visibleSubjects(t: T, userId: string): Promise<string[]> {
  const rows = await t
    .withIdentity({ subject: userId })
    .query(api.conversations.queries.listConversations, {
      organizationId: ORG,
    });
  return rows.map((r) => r.subject ?? '').sort();
}

async function canGet(
  t: T,
  userId: string,
  conversationId: Id<'conversations'>,
): Promise<boolean> {
  const row = await t
    .withIdentity({ subject: userId })
    .query(api.conversations.queries.getConversationWithMessages, {
      conversationId,
      organizationId: ORG,
    });
  return row !== null;
}

describe('conversation assignment privacy RLS (built-in)', () => {
  let t: T;
  let ids: Seeded;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    ids = await seedWorld(t);
  });

  it('an admin sees every conversation including true unassigned', async () => {
    expect(await visibleSubjects(t, ADMIN)).toHaveLength(4);
    expect(await canGet(t, ADMIN, ids.unassigned)).toBe(true);
    expect(await canGet(t, ADMIN, ids.teamY)).toBe(true);
  });

  it('a team member sees only their team queue — not unassigned or other teams', async () => {
    expect(await visibleSubjects(t, TEAM_MEMBER)).toEqual(['Queued to Team X']);
    expect(await canGet(t, TEAM_MEMBER, ids.unassigned)).toBe(false);
    expect(await canGet(t, TEAM_MEMBER, ids.owned)).toBe(false);
    expect(await canGet(t, TEAM_MEMBER, ids.teamY)).toBe(false);
    expect(await canGet(t, TEAM_MEMBER, ids.teamX)).toBe(true);
  });

  it('the individual owner sees only their own conversation — not unassigned', async () => {
    expect(await visibleSubjects(t, OWNER_USER)).toEqual(['Owned by a person']);
    expect(await canGet(t, OWNER_USER, ids.unassigned)).toBe(false);
    expect(await canGet(t, OWNER_USER, ids.teamX)).toBe(false);
  });

  it('a member with no team and no ownership sees nothing', async () => {
    expect(await visibleSubjects(t, PLAIN_MEMBER)).toEqual([]);
    expect(await canGet(t, PLAIN_MEMBER, ids.unassigned)).toBe(false);
  });

  it('a leftover conversation_access configCache row is ignored', async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert('configCache', {
        organizationId: ORG,
        domain: 'governance',
        key: 'conversation_access',
        config: { restrictAssigned: false },
        syncedAt: 0,
      });
    });
    expect(await visibleSubjects(t, PLAIN_MEMBER)).toEqual([]);
    expect(await visibleSubjects(t, TEAM_MEMBER)).toEqual(['Queued to Team X']);
  });

  it('a visible conversation still returns its messages; a hidden one returns null', async () => {
    await t.run(async (ctx) => {
      for (const conversationId of [ids.teamX, ids.teamY]) {
        await ctx.db.insert('conversationMessages', {
          organizationId: ORG,
          conversationId,
          channel: 'email',
          direction: 'inbound',
          deliveryState: 'delivered',
          content: 'hello',
        });
      }
    });
    const visible = await t
      .withIdentity({ subject: TEAM_MEMBER })
      .query(api.conversations.queries.getConversationWithMessages, {
        conversationId: ids.teamX,
        organizationId: ORG,
      });
    expect(visible?.messages).toHaveLength(1);
    expect(await canGet(t, TEAM_MEMBER, ids.teamY)).toBe(false);
  });
});
