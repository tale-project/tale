// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_3_4/03_backfill_contacts_from_customers';
const ORG = 'org_test_1';

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state, down restoring the
// seed digest byte-for-byte (customers untouched, contacts gone), and the
// ledger transitions.
defineMigrationTest({
  id: '0.3.4/03_backfill_contacts_from_customers',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('customers', {
      organizationId: ORG,
      name: 'Jane Buyer',
      email: 'jane@buyer.test',
      status: 'potential',
      source: 'manual_import',
    });
    // Sparse edge: a customer with no contact details still becomes a contact.
    await ctx.db.insert('customers', {
      organizationId: ORG,
      source: 'manual_import',
    });
  },

  async expectUp(world) {
    const contacts = (await world.run((ctx) =>
      ctx.db.query('contacts').collect(),
    )) as Array<Record<string, unknown>>;
    expect(contacts).toHaveLength(2);
    const jane = contacts.find((c) => c.name === 'Jane Buyer');
    expect(jane).toMatchObject({
      organizationId: ORG,
      email: 'jane@buyer.test',
    });
    // The customer-only `status` field is dropped — contacts is status-less.
    expect(jane && 'status' in jane).toBe(false);
    expect(jane?.metadata).toMatchObject({
      __migratedFrom: { table: 'customers' },
    });

    // The source customer rows (incl. their status) are untouched.
    const customers = (await world.run((ctx) =>
      ctx.db.query('customers').collect(),
    )) as Array<Record<string, unknown>>;
    expect(customers).toHaveLength(2);
    expect(customers.find((c) => c.name === 'Jane Buyer')).toMatchObject({
      status: 'potential',
    });
  },
});
