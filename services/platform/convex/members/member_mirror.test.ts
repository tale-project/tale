import { convexTest } from 'convex-test';
import { defineSchema } from 'convex/server';
import { describe, expect, it } from 'vitest';

import { isOrgMember } from '../lib/rls/auth/check_org_membership';
import { getUserOrganizations } from '../lib/rls/organization/get_user_organizations';
import { buildModules } from '../lib/test_helpers';
import {
  upsertMemberMirror,
  deleteMemberMirrorByMemberId,
} from './mirror_sync';
import { memberMirrorTable, memberMirrorReconcileCursorTable } from './schema';

// convex-test only needs the tables the mirror code reads/writes. The hot-path
// readers (isOrgMember / getUserOrganizations) and the inline sync helpers all
// stay on `ctx.db` for the cases exercised here — they only hit the
// cross-component Better Auth adapter on a MISS, which these tests don't take.
const schema = defineSchema({
  memberMirror: memberMirrorTable,
  memberMirrorReconcileCursor: memberMirrorReconcileCursorTable,
});
const modules = buildModules(import.meta.glob('../**/*.*s'), 'members');

const ORG = 'org_1';
const USER = { userId: 'user_1', email: 'u@example.com', name: 'U' };

function newTest() {
  return convexTest(schema, modules);
}

describe('member mirror — inline sync helpers', () => {
  it('upserts, then is idempotent and patches in place (no duplicate rows)', async () => {
    const t = newTest();

    await t.run((ctx) =>
      upsertMemberMirror(ctx, {
        memberId: 'm1',
        userId: USER.userId,
        organizationId: ORG,
        role: 'ADMIN', // stored lowercase
        createdAt: 100,
      }),
    );

    let rows = await t.run((ctx) => ctx.db.query('memberMirror').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      memberId: 'm1',
      userId: USER.userId,
      organizationId: ORG,
      role: 'admin',
      createdAt: 100,
    });
    expect(rows[0].updatedAt).toBeTypeOf('number');

    // Same payload again → still one row.
    await t.run((ctx) =>
      upsertMemberMirror(ctx, {
        memberId: 'm1',
        userId: USER.userId,
        organizationId: ORG,
        role: 'admin',
        createdAt: 100,
      }),
    );
    rows = await t.run((ctx) => ctx.db.query('memberMirror').collect());
    expect(rows).toHaveLength(1);

    // Role change → patched in place, still one row.
    await t.run((ctx) =>
      upsertMemberMirror(ctx, {
        memberId: 'm1',
        userId: USER.userId,
        organizationId: ORG,
        role: 'member',
        createdAt: 100,
      }),
    );
    rows = await t.run((ctx) => ctx.db.query('memberMirror').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('member');
  });

  it('deletes by memberId (and is a no-op when absent)', async () => {
    const t = newTest();
    await t.run((ctx) =>
      upsertMemberMirror(ctx, {
        memberId: 'm1',
        userId: USER.userId,
        organizationId: ORG,
        role: 'member',
        createdAt: 100,
      }),
    );

    await t.run((ctx) => deleteMemberMirrorByMemberId(ctx, 'm1'));
    expect(
      await t.run((ctx) => ctx.db.query('memberMirror').collect()),
    ).toHaveLength(0);

    // No-op on a missing id.
    await t.run((ctx) => deleteMemberMirrorByMemberId(ctx, 'does-not-exist'));
    expect(
      await t.run((ctx) => ctx.db.query('memberMirror').collect()),
    ).toHaveLength(0);
  });
});

describe('member mirror — isOrgMember (mirror hit)', () => {
  it('returns true for a live membership and false for a disabled one — no Better Auth call', async () => {
    const t = newTest();
    await t.run(async (ctx) => {
      await upsertMemberMirror(ctx, {
        memberId: 'm1',
        userId: USER.userId,
        organizationId: ORG,
        role: 'member',
        createdAt: 1,
      });
      await upsertMemberMirror(ctx, {
        memberId: 'm2',
        userId: 'user_disabled',
        organizationId: ORG,
        role: 'disabled',
        createdAt: 1,
      });
    });

    expect(await t.run((ctx) => isOrgMember(ctx, USER.userId, ORG))).toBe(true);
    expect(await t.run((ctx) => isOrgMember(ctx, 'user_disabled', ORG))).toBe(
      false,
    );
  });
});

describe('member mirror — getUserOrganizations (mirror hit)', () => {
  it('maps mirror rows to memberships, normalizes roles, and filters disabled', async () => {
    const t = newTest();
    await t.run(async (ctx) => {
      await upsertMemberMirror(ctx, {
        memberId: 'm1',
        userId: USER.userId,
        organizationId: 'org_a',
        role: 'owner',
        createdAt: 1,
      });
      await upsertMemberMirror(ctx, {
        memberId: 'm2',
        userId: USER.userId,
        organizationId: 'org_b',
        role: 'editor',
        createdAt: 2,
      });
      // Disabled membership must be filtered out of the result.
      await upsertMemberMirror(ctx, {
        memberId: 'm3',
        userId: USER.userId,
        organizationId: 'org_c',
        role: 'disabled',
        createdAt: 3,
      });
    });

    const orgs = await t.run((ctx) => getUserOrganizations(ctx, USER));
    const byOrg = Object.fromEntries(orgs.map((o) => [o.organizationId, o]));

    expect(orgs).toHaveLength(2);
    expect(byOrg.org_a?.role).toBe('owner');
    expect(byOrg.org_b?.role).toBe('editor');
    expect(byOrg.org_c).toBeUndefined();
    // The mirrored member._id is surfaced (the Better Auth member id).
    expect(byOrg.org_a?.member._id).toBe('m1');
  });
});
