// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/05_drop_model_catalog_sync';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.4.0/05_drop_model_catalog_sync',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    // A successful sync row and a failed one (error present) — both shapes
    // must survive the snapshot round-trip.
    await ctx.db.insert('modelCatalogSync', {
      source: 'openrouter',
      lastSyncedAt: 1_717_000_100_000,
      modelCount: 231,
      ok: true,
    });
    await ctx.db.insert('modelCatalogSync', {
      source: 'provider:bigmodel',
      lastSyncedAt: 1_717_000_200_000,
      modelCount: 0,
      ok: false,
      error: 'catalog fetch 404 Not Found',
    });
  },

  async expectUp(world) {
    const rows = await world.run((ctx) =>
      ctx.db.query('modelCatalogSync').collect(),
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
      snaps.map((s) => (s.payload as { source: string }).source).sort(),
    ).toEqual(['openrouter', 'provider:bigmodel']);
  },
});
