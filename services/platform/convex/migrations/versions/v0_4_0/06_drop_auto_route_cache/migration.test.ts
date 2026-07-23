// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/06_drop_auto_route_cache';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.4.0/06_drop_auto_route_cache',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('autoRouteCache', {
      organizationId: 'org_0',
      candidatesHash: 'roster-hash-1',
      messageKey: 'summarize the q2 report',
      agentSlug: 'assistant',
      source: 'classified',
      language: 'en',
      tuning: { style: 'concise', verbosity: 'normal' },
      seed: { effort: 'low', creativity: 'balanced' },
      capabilities: ['web_search'],
      hits: 5,
      createdAt: 1_717_000_100_000,
      lastUsedAt: 1_717_000_150_000,
    });
    await ctx.db.insert('autoRouteCache', {
      organizationId: 'org_1',
      candidatesHash: 'roster-hash-2',
      messageKey: 'draft a reply',
      agentSlug: 'writer',
      source: 'override',
      hits: 1,
      createdAt: 1_717_000_200_000,
      lastUsedAt: 1_717_000_200_000,
    });
  },

  async expectUp(world) {
    const rows = await world.run((ctx) =>
      ctx.db.query('autoRouteCache').collect(),
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
