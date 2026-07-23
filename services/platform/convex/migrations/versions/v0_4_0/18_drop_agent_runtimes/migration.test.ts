// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/18_drop_agent_runtimes';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.4.0/18_drop_agent_runtimes',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('agentRuntimes', {
      organizationId: 'org_0',
      daemonId: 'daemon-1',
      adapterType: 'claude-code',
      name: 'Workstation',
      version: '1.2.3',
      capabilities: {
        jsonOutput: true,
        sessionResume: true,
        costReporting: true,
        mcp: false,
      },
      workspaceKeys: ['main'],
      createdBy: 'user_0',
      registeredAt: 1_717_000_100_000,
      lastHeartbeatAt: 1_717_000_120_000,
    });
    await ctx.db.insert('agentRuntimes', {
      organizationId: 'org_1',
      daemonId: 'daemon-2',
      adapterType: 'codex',
      createdBy: 'user_1',
      registeredAt: 1_717_000_200_000,
      lastHeartbeatAt: 1_717_000_220_000,
    });
  },

  async expectUp(world) {
    const rows = await world.run((ctx) =>
      ctx.db.query('agentRuntimes').collect(),
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
      snaps.map((s) => (s.payload as { daemonId: string }).daemonId).sort(),
    ).toEqual(['daemon-1', 'daemon-2']);
  },
});
