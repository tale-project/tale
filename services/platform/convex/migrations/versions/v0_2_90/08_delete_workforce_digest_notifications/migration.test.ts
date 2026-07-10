// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR =
  'migrations/versions/v0_2_90/08_delete_workforce_digest_notifications';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte (both digest
// rows back, the task_assigned row untouched).
defineMigrationTest({
  id: '0.2.90/08_delete_workforce_digest_notifications',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('userNotifications', {
      userId: 'user_1',
      organizationId: 'org_1',
      type: 'workforce_digest',
      titleKey: 'workforceDigest',
      bodyKey: 'workforceDigestBody',
      resourceType: 'dashboard',
      resourceId: 'org_1',
      actorType: 'system',
      read: false,
      createdAt: 1_000,
    });
    await ctx.db.insert('userNotifications', {
      userId: 'user_2',
      organizationId: 'org_1',
      type: 'workforce_digest',
      titleKey: 'workforceDigest',
      bodyKey: 'workforceDigestBody',
      resourceType: 'dashboard',
      resourceId: 'org_1',
      actorType: 'system',
      read: true,
      readAt: 2_000,
      createdAt: 1_000,
    });
    // A different notification type — must survive up.
    await ctx.db.insert('userNotifications', {
      userId: 'user_1',
      organizationId: 'org_1',
      type: 'task_assigned',
      titleKey: 'taskAssigned',
      bodyKey: 'taskAssignedBody',
      resourceType: 'task',
      resourceId: 'task_1',
      actorType: 'user',
      read: false,
      createdAt: 3_000,
    });
  },

  async expectUp(world) {
    // Digest rows deleted; other notification types survive.
    const remaining = await world.run(
      async (ctx) =>
        (await ctx.db.query('userNotifications').collect()) as Array<
          Record<string, unknown>
        >,
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0].type).toBe('task_assigned');

    // One snapshot per deleted digest row.
    const snaps = await world.run(
      async (ctx) =>
        (await ctx.db
          .query('migrationSnapshots')
          .withIndex(
            'by_migration',
            (q: { eq: (f: string, v: string) => unknown }) =>
              q.eq('migrationId', world.meta.id),
          )
          .collect()) as Array<Record<string, unknown>>,
    );
    expect(snaps).toHaveLength(2);
    expect(
      snaps.map(
        (s: Record<string, unknown>) => (s.payload as { type: string }).type,
      ),
    ).toEqual(['workforce_digest', 'workforce_digest']);
  },
});
