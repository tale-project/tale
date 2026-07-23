// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/07_drop_mcp_servers';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.4.0/07_drop_mcp_servers',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('mcpServers', {
      organizationId: 'org_0',
      name: 'filesystem',
      displayName: 'Filesystem',
      transportType: 'stdio',
      command: 'npx',
      args: ['-y', 'mcp-fs'],
      authType: 'none',
      status: 'active',
      capabilities: { tools: true },
    });
    await ctx.db.insert('mcpServers', {
      organizationId: 'org_1',
      name: 'github',
      displayName: 'GitHub',
      transportType: 'streamable_http',
      url: 'https://mcp.example.com',
      authType: 'oauth2',
      status: 'inactive',
      oauth2Config: {
        tokenUrl: 'https://mcp.example.com/token',
        clientId: 'client-abc',
        clientSecretEncrypted: 'enc-secret',
        scopes: ['repo'],
        grantType: 'client_credentials',
      },
    });
  },

  async expectUp(world) {
    const rows = await world.run((ctx) => ctx.db.query('mcpServers').collect());
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
      snaps.map((s) => (s.payload as { name: string }).name).sort(),
    ).toEqual(['filesystem', 'github']);
  },
});
