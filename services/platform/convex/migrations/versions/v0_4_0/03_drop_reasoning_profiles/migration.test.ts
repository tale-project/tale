// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/03_drop_reasoning_profiles';

const bucket = (count: number) => ({
  count,
  mean: 0.4 + count / 10,
  m2: 0.02 * count,
  underResourcedEma: 0.1,
});

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.4.0/03_drop_reasoning_profiles',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    // Two orgs, one with the optional intensity fields and a full lastTier
    // bucket — the drop must carry every field shape through the snapshot.
    await ctx.db.insert('reasoningProfiles', {
      organizationId: 'org_0',
      scopeKey: 'openrouter:qwen-3-235b',
      state: {
        easy: bucket(3),
        medium: bucket(5),
        hard: { ...bucket(2), wastefulEma: 0.3, lastTier: 'high' },
        turns: 10,
        intensityCount: 4,
        intensityMean: 0.6,
        intensityM2: 0.04,
      },
      updatedAt: 1_717_000_100_000,
    });
    await ctx.db.insert('reasoningProfiles', {
      organizationId: 'org_1',
      scopeKey: 'anthropic:claude-sonnet-4',
      state: {
        easy: bucket(1),
        medium: bucket(1),
        hard: bucket(1),
        turns: 3,
      },
      updatedAt: 1_717_000_200_000,
    });
  },

  async expectUp(world) {
    const rows = await world.run((ctx) =>
      ctx.db.query('reasoningProfiles').collect(),
    );
    expect(rows).toHaveLength(0);

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
    expect(snaps).toHaveLength(2);
    expect(
      snaps
        .map((s) => (s.payload as { organizationId: string }).organizationId)
        .sort(),
    ).toEqual(['org_0', 'org_1']);
  },
});
