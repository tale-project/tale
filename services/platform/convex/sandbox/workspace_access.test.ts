// The workspace bridge's access gate must answer exactly like a user-side
// RLS read: membership from the memberMirror fast path (disabled dropped),
// role checked against the one role→table→action matrix. Only mirror-HIT
// paths are exercised — a mirror miss falls back to the Better Auth
// component, which convex-test does not host (same stance as
// members/member_mirror.test.ts).

import { convexTest } from 'convex-test';
import { defineSchema } from 'convex/server';
import { describe, expect, it } from 'vitest';

import { resolveAgentReadAccess } from '../lib/rls/helpers/agent_read_access';
import { memberMirrorTable } from '../members/schema';
import { buildModules } from '../migrations/framework/test_helpers';

const schema = defineSchema({ memberMirror: memberMirrorTable });
const modules = buildModules(import.meta.glob('../**/*.*s'), 'sandbox');

const ORG = 'org_A';

function newTest() {
  return convexTest(schema, modules);
}

async function seedMember(
  t: ReturnType<typeof newTest>,
  args: { userId: string; organizationId: string; role: string },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `mm_${args.userId}_${args.organizationId}`,
      userId: args.userId,
      organizationId: args.organizationId,
      role: args.role,
      createdAt: 1,
    });
  });
}

describe('resolveAgentReadAccess', () => {
  it('an active member reads every workspace subject', async () => {
    const t = newTest();
    await seedMember(t, { userId: 'u1', organizationId: ORG, role: 'member' });
    for (const subject of [
      'documents',
      'contacts',
      'products',
      'websites',
    ] as const) {
      const access = await t.run((ctx) =>
        resolveAgentReadAccess(ctx, {
          userId: 'u1',
          organizationId: ORG,
          subject,
        }),
      );
      expect(access).toEqual({ allowed: true, role: 'member' });
    }
  });

  it('owner normalizes like the RLS path (admin matrix row)', async () => {
    const t = newTest();
    await seedMember(t, { userId: 'u2', organizationId: ORG, role: 'owner' });
    const access = await t.run((ctx) =>
      resolveAgentReadAccess(ctx, {
        userId: 'u2',
        organizationId: ORG,
        subject: 'contacts',
      }),
    );
    expect(access).toEqual({ allowed: true, role: 'owner' });
  });

  it('a disabled membership is not a membership', async () => {
    const t = newTest();
    await seedMember(t, {
      userId: 'u3',
      organizationId: ORG,
      role: 'disabled',
    });
    const access = await t.run((ctx) =>
      resolveAgentReadAccess(ctx, {
        userId: 'u3',
        organizationId: ORG,
        subject: 'documents',
      }),
    );
    expect(access).toEqual({ allowed: false, reason: 'not_a_member' });
  });

  it("membership in another org never reaches this org's data", async () => {
    const t = newTest();
    await seedMember(t, {
      userId: 'u4',
      organizationId: 'org_B',
      role: 'admin',
    });
    const access = await t.run((ctx) =>
      resolveAgentReadAccess(ctx, {
        userId: 'u4',
        organizationId: ORG,
        subject: 'products',
      }),
    );
    expect(access).toEqual({ allowed: false, reason: 'not_a_member' });
  });
});
