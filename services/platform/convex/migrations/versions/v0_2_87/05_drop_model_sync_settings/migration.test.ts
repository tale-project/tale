// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_2_87/05_drop_model_sync_settings';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.2.87/05_drop_model_sync_settings',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert('modelSyncSettings', {
        organizationId: `org_${i}`,
        autoSyncEnabled: i % 2 === 0,
      });
    }
  },

  async expectUp(world) {
    const legacy = await world.run((ctx) =>
      ctx.db.query('modelSyncSettings').collect(),
    );
    expect(legacy).toHaveLength(0);

    // One snapshot per deleted row, carrying the full legacy payload.
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
    expect(snaps).toHaveLength(3);
    expect(
      snaps
        .map(
          (s: Record<string, unknown>) =>
            (s.payload as { organizationId: string }).organizationId,
        )
        .sort(),
    ).toEqual(['org_0', 'org_1', 'org_2']);
  },
});
