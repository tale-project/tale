// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/12_drop_tts_gc_cursor';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.4.0/12_drop_tts_gc_cursor',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('ttsGcCursor', {
      job: 'gcOrgTtsChunks',
      lastOrgId: 'org_0',
      updatedAt: 1_717_000_100_000,
    });
    await ctx.db.insert('ttsGcCursor', {
      job: 'gcOrgTtsChunksSecondary',
      lastOrgId: null,
      updatedAt: 1_717_000_200_000,
    });
  },

  async expectUp(world) {
    const rows = await world.run((ctx) =>
      ctx.db.query('ttsGcCursor').collect(),
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
    expect(snaps.map((s) => (s.payload as { job: string }).job).sort()).toEqual(
      ['gcOrgTtsChunks', 'gcOrgTtsChunksSecondary'],
    );
  },
});
