import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/notifications/), mirroring audit_logs/integrity_check.test.ts.
const TEST_DIR_FROM_CONVEX_ROOT = 'notifications';
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

const ORG = 'org_notifications_audience';
const ADMIN = 'user_admin';
const MEMBER = 'user_member';
type T = TestConvex<typeof schema>;

// Seed the local member mirror so the org-membership gate resolves on its hot
// path and never falls back to the (test-unavailable) Better Auth component.
async function seedMember(
  t: T,
  userId: string,
  memberId: string,
  role: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId,
      userId,
      organizationId: ORG,
      role,
      createdAt: 0,
    });
  });
}

// One `security` and one `system` notification, both unread.
async function seedNotifications(t: T): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('notifications', {
      organizationId: ORG,
      category: 'security',
      severity: 'critical',
      titleKey: 'auditIntegrityFailed',
      bodyKey: 'auditIntegrityFailedDetails',
      createdAt: 2,
      readBy: [],
    });
    await ctx.db.insert('notifications', {
      organizationId: ORG,
      category: 'system',
      severity: 'info',
      titleKey: 'systemNotice',
      bodyKey: 'systemNoticeDetails',
      createdAt: 1,
      readBy: [],
    });
  });
}

async function categoriesFor(t: T, subject: string): Promise<string[]> {
  const { page } = await t
    .withIdentity({ subject })
    .query(api.notifications.queries.list, {
      organizationId: ORG,
      paginationOpts: { cursor: null, numItems: 50 },
    });
  return page.map((n) => n.category);
}

async function securityReadBy(t: T): Promise<string[]> {
  return await t.run(async (ctx) => {
    for (const n of await ctx.db.query('notifications').collect()) {
      if (n.organizationId === ORG && n.category === 'security')
        return n.readBy;
    }
    throw new Error('security notification not found');
  });
}

// #1845: `security` notifications are admin-only. `list`/`unreadCount`/
// `markAllRead` must agree on that audience so a non-admin never sees — or
// dismisses — a security row.
describe('security notification audience (#1845)', () => {
  it('list shows security rows to admins but hides them from non-admins', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ADMIN, 'm_admin', 'admin');
    await seedMember(t, MEMBER, 'm_member', 'member');
    await seedNotifications(t);

    expect(await categoriesFor(t, ADMIN)).toEqual(['security', 'system']);
    expect(await categoriesFor(t, MEMBER)).toEqual(['system']);
  });

  it('unreadCount excludes security rows for non-admins', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ADMIN, 'm_admin', 'admin');
    await seedMember(t, MEMBER, 'm_member', 'member');
    await seedNotifications(t);

    expect(
      await t
        .withIdentity({ subject: ADMIN })
        .query(api.notifications.queries.unreadCount, { organizationId: ORG }),
    ).toBe(2);
    expect(
      await t
        .withIdentity({ subject: MEMBER })
        .query(api.notifications.queries.unreadCount, { organizationId: ORG }),
    ).toBe(1);
  });

  it('markAllRead by a non-admin leaves the security row unread', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, MEMBER, 'm_member', 'member');
    await seedNotifications(t);

    await t
      .withIdentity({ subject: MEMBER })
      .mutation(api.notifications.mutations.markAllRead, {
        organizationId: ORG,
      });

    // The member never saw the security row, so it must stay unread by them —
    // else an admin's later view would show it already dismissed.
    expect(await securityReadBy(t)).not.toContain(MEMBER);
    // The non-admin's own unread count is now 0 (only the system row existed
    // for them, and it is marked read).
    expect(
      await t
        .withIdentity({ subject: MEMBER })
        .query(api.notifications.queries.unreadCount, { organizationId: ORG }),
    ).toBe(0);
  });
});
