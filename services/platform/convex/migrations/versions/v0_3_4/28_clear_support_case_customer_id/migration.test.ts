// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_3_4/28_clear_support_case_customer_id';
const ORG = 'org_test_1';

// Sibling of 0.3.4/27 for supportCases — the harness's digest-equal down
// proves the stamp-based customerId recovery byte-for-byte.
defineMigrationTest({
  id: '0.3.4/28_clear_support_case_customer_id',
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
    // Post-0.3.4/25 state: link repointed, legacy field still present.
    await ctx.db.insert('supportCases', {
      organizationId: ORG,
      subject: 'Invoice discrepancy',
      status: 'open',
      customerId: custId,
      contactId,
      createdBy: 'user_1',
      createdByType: 'user',
      createdAt: 1,
      updatedAt: 1,
    });
    // Edge: requester-only case (no customerId, no contactId) — untouched.
    await ctx.db.insert('supportCases', {
      organizationId: ORG,
      subject: 'Password reset loop',
      status: 'pending',
      requesterEmail: 'visitor@example.com',
      createdBy: 'user_1',
      createdByType: 'user',
      createdAt: 1,
      updatedAt: 1,
    });
  },

  async expectUp(world) {
    const cases = (await world.run((ctx) =>
      ctx.db.query('supportCases').collect(),
    )) as Array<Record<string, unknown>>;
    const repointed = cases.find((c) => c.contactId !== undefined);
    const requesterOnly = cases.find((c) => c.contactId === undefined);
    expect(repointed?.customerId).toBeUndefined();
    expect(requesterOnly?.customerId).toBeUndefined();
    expect(requesterOnly?.requesterEmail).toBe('visitor@example.com');
  },
});
