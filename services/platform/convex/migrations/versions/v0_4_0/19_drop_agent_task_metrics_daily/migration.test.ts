// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/19_drop_agent_task_metrics_daily';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.4.0/19_drop_agent_task_metrics_daily',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('agentTaskMetricsDaily', {
      organizationId: 'org_0',
      agentSlug: 'assistant',
      dateKey: '2024-05-29',
      runsStarted: 3,
      runsCompleted: 2,
      runsFailed: 1,
      runDurationSumMs: 5000,
      runDurationCount: 2,
      inputTokens: 1500,
      outputTokens: 600,
      costCents: 4,
      tasksCompleted: 2,
      reviewsPassed: 1,
      reviewsChangesRequested: 0,
      escalations: 0,
      staleEod: 0,
      computedAt: 1_717_000_100_000,
    });
    await ctx.db.insert('agentTaskMetricsDaily', {
      organizationId: 'org_1',
      agentSlug: 'writer',
      dateKey: '2024-05-30',
      runsStarted: 0,
      runsCompleted: 0,
      runsFailed: 0,
      runDurationSumMs: 0,
      runDurationCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      tasksCompleted: 0,
      reviewsPassed: 0,
      reviewsChangesRequested: 0,
      escalations: 0,
      staleEod: 0,
      computedAt: 1_717_000_200_000,
    });
  },

  async expectUp(world) {
    const rows = await world.run((ctx) =>
      ctx.db.query('agentTaskMetricsDaily').collect(),
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
