// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/14_drop_wf_webhooks';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.4.0/14_drop_wf_webhooks',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('wfWebhooks', {
      organizationId: 'org_0',
      workflowSlug: 'issue-desk/desk-process',
      token: 'wf-webhook-token-1',
      isActive: true,
      lastTriggeredAt: 1_717_000_120_000,
      createdAt: 1_717_000_100_000,
      createdBy: 'user_0',
    });
    await ctx.db.insert('wfWebhooks', {
      organizationId: 'org_1',
      token: 'wf-webhook-token-2',
      isActive: false,
      createdAt: 1_717_000_200_000,
      createdBy: 'user_1',
    });
  },

  async expectUp(world) {
    const rows = await world.run((ctx) => ctx.db.query('wfWebhooks').collect());
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
      snaps.map((s) => (s.payload as { token: string }).token).sort(),
    ).toEqual(['wf-webhook-token-1', 'wf-webhook-token-2']);
  },
});
