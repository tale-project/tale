// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_3_4/05_backfill_support_case_contact_id';
const ORG = 'org_test_1';

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state, down restoring the
// seed digest byte-for-byte (contactId cleared, customerId untouched), and
// the ledger transitions.
//
// The contacts row is seeded DIRECTLY with the `metadata.__migratedFrom`
// stamp 0.3.4/23 writes — this migration only consumes the stamp.
defineMigrationTest({
  id: '0.3.4/25_backfill_support_case_contact_id',
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
    await ctx.db.insert('supportCases', {
      organizationId: ORG,
      subject: 'Broken widget',
      status: 'open',
      customerId: custId,
      createdBy: 'user_1',
      createdByType: 'user',
      createdAt: 1,
      updatedAt: 1,
    });
    // A requester-only case (no customerId) — must be left untouched.
    await ctx.db.insert('supportCases', {
      organizationId: ORG,
      subject: 'Anonymous ask',
      status: 'open',
      requesterEmail: 'nobody@ext.test',
      createdBy: 'user_1',
      createdByType: 'user',
      createdAt: 2,
      updatedAt: 2,
    });
  },

  async expectUp(world) {
    const contacts = (await world.run((ctx) =>
      ctx.db.query('contacts').collect(),
    )) as Array<Record<string, unknown>>;
    const cases = (await world.run((ctx) =>
      ctx.db.query('supportCases').collect(),
    )) as Array<Record<string, unknown>>;

    const linked = cases.find((c) => c.subject === 'Broken widget');
    expect(linked?.contactId).toBe(contacts[0]._id);
    expect(linked?.customerId).toBeDefined();

    // The requester-only case gains no contactId.
    const anon = cases.find((c) => c.subject === 'Anonymous ask');
    expect(anon?.contactId).toBeUndefined();
  },
});
