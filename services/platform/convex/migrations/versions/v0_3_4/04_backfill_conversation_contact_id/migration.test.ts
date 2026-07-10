// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_3_4/04_backfill_conversation_contact_id';
const ORG = 'org_test_1';

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state, down restoring the
// seed digest byte-for-byte (contactId cleared, customerId untouched), and
// the ledger transitions.
//
// The contacts row is seeded DIRECTLY with the `metadata.__migratedFrom`
// stamp 0.3.4/03 writes — this migration only consumes the stamp.
defineMigrationTest({
  id: '0.3.4/04_backfill_conversation_contact_id',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    const custId = await ctx.db.insert('customers', {
      organizationId: ORG,
      email: 'jane@buyer.test',
      status: 'active',
      source: 'manual_import',
    });
    await ctx.db.insert('contacts', {
      organizationId: ORG,
      email: 'jane@buyer.test',
      source: 'manual_import',
      metadata: { __migratedFrom: { table: 'customers', id: custId } },
    });
    await ctx.db.insert('conversations', {
      organizationId: ORG,
      customerId: custId,
      status: 'open',
    });
  },

  async expectUp(world) {
    const contacts = (await world.run((ctx) =>
      ctx.db.query('contacts').collect(),
    )) as Array<Record<string, unknown>>;
    const convs = (await world.run((ctx) =>
      ctx.db.query('conversations').collect(),
    )) as Array<Record<string, unknown>>;
    expect(convs).toHaveLength(1);
    expect(convs[0].contactId).toBe(contacts[0]._id);
    // The legacy FK is left in place (dropped later in the teardown phase).
    const stamp = (contacts[0].metadata as Record<string, unknown>)
      .__migratedFrom as Record<string, unknown>;
    expect(convs[0].customerId).toBe(stamp.id);
  },
});
