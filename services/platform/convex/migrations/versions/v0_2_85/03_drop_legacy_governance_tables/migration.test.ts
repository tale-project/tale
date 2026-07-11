// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_2_85/03_drop_legacy_governance_tables';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.2.85/03_drop_legacy_governance_tables',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert('governancePolicies', {
        organizationId: `org_${i}`,
        policyType: 'password_policy',
        config: { minLength: 8 + i },
        enabled: true,
      });
    }
  },

  async expectUp(world) {
    const legacy = await world.run((ctx) =>
      ctx.db.query('governancePolicies').collect(),
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
    expect(snaps[0].payload).toMatchObject({ policyType: 'password_policy' });
    expect(
      snaps
        .map(
          (s: Record<string, unknown>) =>
            (s.payload as { config: { minLength: number } }).config.minLength,
        )
        .sort((a: number, b: number) => a - b),
    ).toEqual([8, 9, 10]);
  },
});
