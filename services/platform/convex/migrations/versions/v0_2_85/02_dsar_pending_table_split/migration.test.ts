// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_2_85/02_dsar_pending_table_split';
const ORG = 'org_test_1';

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state, down restoring the
// seed digest byte-for-byte (pending row folded back onto the DSAR row and
// deleted), and the ledger transitions.
defineMigrationTest({
  id: '0.2.85/02_dsar_pending_table_split',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('governancePolicies', {
      organizationId: ORG,
      policyType: 'dsar_governance',
      config: { coolingOffHours: 48 },
      pendingConfig: { coolingOffHours: 12 },
      pendingEffectiveAt: 1_000,
      pendingProposedBy: 'admin_1',
      pendingProposedByEmail: 'admin@example.com',
      pendingProposedAt: 500,
    });
    // Sibling non-DSAR row for the same org: down must fold the pending row
    // back onto the dsar_governance row ONLY — folding onto this one would
    // break the digest restore.
    await ctx.db.insert('governancePolicies', {
      organizationId: ORG,
      policyType: 'password_policy',
      config: { minLength: 12 },
      enabled: true,
    });
  },

  async expectUp(world) {
    const pending = await world.run(
      async (ctx) =>
        (await ctx.db.query('dsarPolicyPendingChanges').collect()) as Array<
          Record<string, unknown>
        >,
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      organizationId: ORG,
      effectiveAt: 1_000,
      proposedBy: 'admin_1',
      proposedByEmail: 'admin@example.com',
      proposedAt: 500,
    });
    expect(pending[0].pendingConfig).toEqual({ coolingOffHours: 12 });
  },
});
