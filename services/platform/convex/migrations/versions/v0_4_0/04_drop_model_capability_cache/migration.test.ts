// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/04_drop_model_capability_cache';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.4.0/04_drop_model_capability_cache',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    // One capability-rich row and one sparse row — the drop must carry both
    // extremes of the cached shape through the snapshot.
    await ctx.db.insert('modelCapabilityCache', {
      modelId: 'anthropic/claude-sonnet-4',
      reasoning: { knob: 'budgetTokens', minBudgetTokens: 1024 },
      promptCaching: { mode: 'explicit-breakpoints', maxBreakpoints: 4 },
      inputCentsPerMillion: 300,
      outputCentsPerMillion: 1500,
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      supportsTools: true,
      supportsVision: true,
      source: 'openrouter',
      fetchedAt: 1_717_000_100_000,
    });
    await ctx.db.insert('modelCapabilityCache', {
      modelId: 'sparse/no-capability-facts',
      source: 'models-endpoint',
      fetchedAt: 1_717_000_200_000,
    });
  },

  async expectUp(world) {
    const rows = await world.run((ctx) =>
      ctx.db.query('modelCapabilityCache').collect(),
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
      snaps.map((s) => (s.payload as { modelId: string }).modelId).sort(),
    ).toEqual(['anthropic/claude-sonnet-4', 'sparse/no-capability-facts']);
  },
});
