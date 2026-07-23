// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/16_drop_agent_default_provisions';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.4.0/16_drop_agent_default_provisions',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('agentDefaultProvisions', {
      organizationId: 'org_0',
      agentSlug: 'assistant',
      contentHash: 'provision-hash-1',
      provisionedAt: 1_717_000_100_000,
    });
    await ctx.db.insert('agentDefaultProvisions', {
      organizationId: 'org_1',
      agentSlug: 'writer',
      contentHash: 'provision-hash-2',
      provisionedAt: 1_717_000_200_000,
    });
  },

  async expectUp(world) {
    const rows = await world.run((ctx) =>
      ctx.db.query('agentDefaultProvisions').collect(),
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
      snaps.map((s) => (s.payload as { agentSlug: string }).agentSlug).sort(),
    ).toEqual(['assistant', 'writer']);
  },
});
