// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_3_4/27_clear_conversation_customer_id';
const ORG = 'org_test_1';

// The harness runs the standard ritual automatically — up through the real
// runner, true handler idempotency, and down restoring the seed digest
// byte-for-byte, which here PROVES the stamp-based recovery: the cleared
// customerId must come back as exactly the seeded customers _id.
defineMigrationTest({
  id: '0.3.4/27_clear_conversation_customer_id',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    const custId = await ctx.db.insert('customers', {
      organizationId: ORG,
      email: 'jane@buyer.test',
      status: 'active',
      source: 'manual_import',
    });
    const contactId = await ctx.db.insert('contacts', {
      organizationId: ORG,
      email: 'jane@buyer.test',
      source: 'manual_import',
      metadata: { __migratedFrom: { table: 'customers', id: custId } },
    });
    // Post-0.3.4/24 state: link repointed, legacy field still present.
    await ctx.db.insert('conversations', {
      organizationId: ORG,
      customerId: custId,
      contactId,
      status: 'open',
    });
    // Edge: customerId without a repointed link — must be left untouched
    // (clearing it would be unrecoverable).
    await ctx.db.insert('conversations', {
      organizationId: ORG,
      customerId: 'customer_vanished_before_backfill',
      status: 'open',
    });
  },

  async expectUp(world) {
    const convs = (await world.run((ctx) =>
      ctx.db.query('conversations').collect(),
    )) as Array<Record<string, unknown>>;
    const repointed = convs.find((c) => c.contactId !== undefined);
    const orphan = convs.find((c) => c.contactId === undefined);
    expect(repointed?.customerId).toBeUndefined();
    expect(orphan?.customerId).toBe('customer_vanished_before_backfill');
  },
});
