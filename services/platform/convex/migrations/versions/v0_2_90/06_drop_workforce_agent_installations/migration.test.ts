// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_2_90/06_drop_workforce_agent_installations';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte (all three
// rows back, non-persona row untouched).
defineMigrationTest({
  id: '0.2.90/06_drop_workforce_agent_installations',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('agentInstallations', {
      organizationId: 'org_1',
      agentSlug: 'chief-executive-officer',
      installedAt: 1_000,
      installedBy: 'user_1',
      contentHash: 'hash-ceo',
      enabled: true,
    });
    await ctx.db.insert('agentInstallations', {
      organizationId: 'org_1',
      agentSlug: 'analyst',
      installedAt: 2_000,
      installedBy: 'system',
      contentHash: 'hash-analyst',
      enabled: false,
      disabledReason: 'user',
    });
    // Not a workforce persona slug — must survive up.
    await ctx.db.insert('agentInstallations', {
      organizationId: 'org_1',
      agentSlug: 'assistant',
      installedAt: 3_000,
      installedBy: 'system',
      contentHash: 'hash-assistant',
      enabled: true,
    });
  },

  async expectUp(world) {
    // Persona rows deleted; the custom agent survives.
    const remaining = await world.run(
      async (ctx) =>
        (await ctx.db.query('agentInstallations').collect()) as Array<
          Record<string, unknown>
        >,
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0].agentSlug).toBe('assistant');

    // One snapshot per deleted persona row.
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
        .map(
          (s: Record<string, unknown>) =>
            (s.payload as { agentSlug: string }).agentSlug,
        )
        .sort(),
    ).toEqual(['analyst', 'chief-executive-officer']);
  },
});
