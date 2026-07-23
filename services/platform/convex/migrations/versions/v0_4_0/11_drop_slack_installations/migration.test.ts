// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/11_drop_slack_installations';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.4.0/11_drop_slack_installations',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('slackInstallations', {
      teamId: 'T0WORLD001',
      teamName: 'Team Zero',
      organizationId: 'org_0',
      slug: 'org-zero',
      botUserId: 'B0WORLD001',
      appId: 'A0WORLD001',
      credentialId: 'slack-credential-0',
      installedAt: 1_717_000_100_000,
      updatedAt: 1_717_000_100_000,
    });
    await ctx.db.insert('slackInstallations', {
      teamId: 'T0WORLD002',
      organizationId: 'org_1',
      slug: 'org-one',
      credentialId: 'slack-credential-1',
      installedAt: 1_717_000_200_000,
      updatedAt: 1_717_000_200_000,
    });
  },

  async expectUp(world) {
    const rows = await world.run((ctx) =>
      ctx.db.query('slackInstallations').collect(),
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
      snaps.map((s) => (s.payload as { teamId: string }).teamId).sort(),
    ).toEqual(['T0WORLD001', 'T0WORLD002']);
  },
});
