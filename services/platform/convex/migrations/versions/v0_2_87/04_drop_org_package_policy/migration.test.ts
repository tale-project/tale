// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_2_87/04_drop_org_package_policy';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.2.87/04_drop_org_package_policy',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert('orgPackagePolicy', {
        organizationId: `org_${i}`,
        defaultMode: 'denylist',
        pythonAllow: [],
        pythonDeny: [`bad_${i}`],
        nodeAllow: [],
        nodeDeny: [],
      });
    }
  },

  async expectUp(world) {
    const legacy = await world.run((ctx) =>
      ctx.db.query('orgPackagePolicy').collect(),
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
    expect(snaps[0].payload).toMatchObject({ defaultMode: 'denylist' });
    expect(
      snaps
        .map(
          (s: Record<string, unknown>) =>
            (s.payload as { pythonDeny: string[] }).pythonDeny[0],
        )
        .sort(),
    ).toEqual(['bad_0', 'bad_1', 'bad_2']);
  },
});
