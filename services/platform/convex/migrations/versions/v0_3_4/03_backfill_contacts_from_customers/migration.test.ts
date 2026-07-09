import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import {
  buildModules,
  historicalSchema,
} from '../../../framework/test_helpers';
import { meta } from './meta';

const DIR = 'migrations/versions/v0_3_4/03_backfill_contacts_from_customers';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const ORG = 'org_test_1';

describe('0.3.4/03 backfill_contacts_from_customers', () => {
  it('is a reversible, non-destructive db migration', () => {
    expect(meta.kind).toBe('db');
    expect(meta.reversible).toBe(true);
    expect(meta.destructive).toBe(false);
  });

  it('up copies customers into contacts WITHOUT status; is idempotent; down deletes them and leaves customers untouched', async () => {
    const t = convexTest(historicalSchema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('customers', {
        organizationId: ORG,
        name: 'Jane Buyer',
        email: 'jane@buyer.test',
        status: 'potential',
        source: 'manual_import',
      });
    });

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });

    const contacts = await t.run((ctx) => ctx.db.query('contacts').collect());
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      organizationId: ORG,
      name: 'Jane Buyer',
      email: 'jane@buyer.test',
    });
    // The customer-only `status` field is dropped — contacts is status-less.
    expect('status' in contacts[0]).toBe(false);
    expect(contacts[0].metadata).toMatchObject({
      __migratedFrom: { table: 'customers' },
    });

    // The source customer row (incl. its status) is untouched.
    const customers = await t.run((ctx) => ctx.db.query('customers').collect());
    expect(customers[0]).toMatchObject({ status: 'potential' });

    // Idempotent: a second up does not duplicate the contact.
    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });
    expect(
      await t.run((ctx) => ctx.db.query('contacts').collect()),
    ).toHaveLength(1);

    // Down removes the migrated contact.
    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.3.3',
      only: [meta.id],
    });
    expect(
      await t.run((ctx) => ctx.db.query('contacts').collect()),
    ).toHaveLength(0);
  });
});
