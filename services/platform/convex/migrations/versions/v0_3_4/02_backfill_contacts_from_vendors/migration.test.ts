// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_3_4/02_backfill_contacts_from_vendors';
const ORG = 'org_test_1';

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state, down restoring the
// seed digest byte-for-byte (vendors untouched, contacts gone), and the
// ledger transitions.
defineMigrationTest({
  id: '0.3.4/02_backfill_contacts_from_vendors',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('vendors', {
      organizationId: ORG,
      name: 'Acme Supply',
      email: 'sales@acme.test',
      phone: '+1-555-0100',
      source: 'manual_import',
      tags: ['supplier'],
      notes: 'net-30 terms',
    });
    // Sparse edge: a vendor with no contact details still becomes a contact.
    await ctx.db.insert('vendors', {
      organizationId: ORG,
      source: 'manual_import',
    });
  },

  async expectUp(world) {
    const contacts = await world.run((ctx) =>
      ctx.db.query('contacts').collect(),
    );
    expect(contacts).toHaveLength(2);
    const acme = contacts.find(
      (c: Record<string, unknown>) => c.name === 'Acme Supply',
    );
    expect(acme).toMatchObject({
      organizationId: ORG,
      email: 'sales@acme.test',
      phone: '+1-555-0100',
      notes: 'net-30 terms',
    });
    expect(acme?.tags).toEqual(['supplier']);
    expect(acme?.metadata).toMatchObject({
      __migratedFrom: { table: 'vendors' },
    });
    // The source rows are never modified.
    const vendors = await world.run((ctx) => ctx.db.query('vendors').collect());
    expect(vendors).toHaveLength(2);
  },
});
