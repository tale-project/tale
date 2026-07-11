/**
 * `taskReview` is a human-in-the-loop safety signal (#2651): the settings UI
 * locks its toggle always-on, and `setNotificationPreferences` must not let a
 * direct/legacy caller persist a `false` value for it — matching the ignore
 * already applied on the read/dispatch side (`notify.ts::isAllowed`,
 * `notify_task_reviews.ts::prefAllows`).
 */
import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
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

const ORG = 'org_preferences_test';
const USER = 'user_preferences';
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

describe('setNotificationPreferences', () => {
  it('drops a direct/legacy write of taskReview:false, leaving other fields intact', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, USER);

    await t
      .withIdentity({ subject: USER })
      .mutation(api.collab.preferences.setNotificationPreferences, {
        organizationId: ORG,
        taskAssigned: false,
        taskReview: false,
      });

    const prefs = await t
      .withIdentity({ subject: USER })
      .query(api.collab.preferences.getNotificationPreferences, {
        organizationId: ORG,
      });

    expect(prefs.taskReview).not.toBe(false);
    expect(prefs.taskAssigned).toBe(false);
  });

  it('self-heals a pre-existing stale taskReview:false row on the next write', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, USER);

    // A row written BEFORE the #2651 always-on lock shipped (or by some
    // other direct/legacy caller that still sends `taskReview: false`).
    await t.run(async (ctx) => {
      await ctx.db.insert('notificationPreferences', {
        userId: USER,
        organizationId: ORG,
        taskReview: false,
        updatedAt: 0,
      });
    });

    await t
      .withIdentity({ subject: USER })
      .mutation(api.collab.preferences.setNotificationPreferences, {
        organizationId: ORG,
        digest: true,
      });

    const prefs = await t
      .withIdentity({ subject: USER })
      .query(api.collab.preferences.getNotificationPreferences, {
        organizationId: ORG,
      });

    expect(prefs.taskReview).not.toBe(false);
    expect(prefs.digest).toBe(true);
  });
});
