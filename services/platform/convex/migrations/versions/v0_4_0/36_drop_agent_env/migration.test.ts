// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/36_drop_agent_env';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte — which is
// what proves a secret comes back exactly as it was stored.
defineMigrationTest({
  id: '0.4.0/36_drop_agent_env',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    // A plaintext variable…
    await ctx.db.insert('agentEnv', {
      organizationId: 'org_0',
      agentSlug: 'assistant',
      key: 'REPORT_TIMEZONE',
      isSecret: false,
      value: 'Europe/Zurich',
      updatedAt: 1_717_000_100_000,
      updatedBy: 'user_admin',
    });
    // …a secret, whose ciphertext must survive the round trip untouched…
    await ctx.db.insert('agentEnv', {
      organizationId: 'org_0',
      agentSlug: 'assistant',
      key: 'PARTNER_API_TOKEN',
      isSecret: true,
      encryptedValue: 'jwe-partner-token-ciphertext',
      maskedPreview: '••••1234',
      updatedAt: 1_717_000_200_000,
      updatedBy: 'user_admin',
    });
    // …and a binding to a credential rather than a literal value, in a second
    // organization: the drain is fleet-wide, not per-org.
    await ctx.db.insert('agentEnv', {
      organizationId: 'org_1',
      agentSlug: 'writer',
      key: 'ANTHROPIC_API_KEY',
      isSecret: true,
      tokenSourceSlug: 'anthropic-subscription',
      updatedAt: 1_717_000_300_000,
      updatedBy: 'user_owner',
    });
  },

  async expectUp(world) {
    const rows = await world.run((ctx) => ctx.db.query('agentEnv').collect());
    expect(rows).toHaveLength(0);

    // One snapshot per deleted row, carrying the full payload — including the
    // ciphertext, which is snapshotted as stored and never decrypted.
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
    expect(snaps).toHaveLength(3);
    expect(snaps.map((s) => (s.payload as { key: string }).key).sort()).toEqual(
      ['ANTHROPIC_API_KEY', 'PARTNER_API_TOKEN', 'REPORT_TIMEZONE'],
    );
    const secret = snaps.find(
      (s) => (s.payload as { key: string }).key === 'PARTNER_API_TOKEN',
    );
    expect(secret).toBeDefined();
    expect(
      (secret?.payload as { encryptedValue?: string } | undefined)
        ?.encryptedValue,
    ).toBe('jwe-partner-token-ciphertext');
  },
});
