import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import {
  buildModules,
  historicalSchema,
} from '../../../framework/test_helpers';
import { meta } from './meta';

const DIR = 'migrations/versions/v0_3_4/02_backfill_contacts_from_vendors';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const ORG = 'org_test_1';

describe('0.3.4/02 backfill_contacts_from_vendors', () => {
  it('is a reversible, non-destructive db migration', () => {
    expect(meta.kind).toBe('db');
    expect(meta.reversible).toBe(true);
    expect(meta.destructive).toBe(false);
  });

  it('up copies vendors into contacts; is idempotent; down deletes them and leaves vendors untouched', async () => {
    const t = convexTest(historicalSchema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('vendors', {
        organizationId: ORG,
        name: 'Acme Supply',
        email: 'sales@acme.test',
        phone: '+1-555-0100',
        source: 'manual_import',
        tags: ['supplier'],
        notes: 'net-30 terms',
      });
    });

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });

    const contacts = await t.run((ctx) => ctx.db.query('contacts').collect());
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      organizationId: ORG,
      name: 'Acme Supply',
      email: 'sales@acme.test',
      phone: '+1-555-0100',
      notes: 'net-30 terms',
    });
    expect(contacts[0].tags).toEqual(['supplier']);
    expect(contacts[0].metadata).toMatchObject({
      __migratedFrom: { table: 'vendors' },
    });

    // Idempotent: a second up does not duplicate the contact.
    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });
    expect(
      await t.run((ctx) => ctx.db.query('contacts').collect()),
    ).toHaveLength(1);

    // Down removes the migrated contact; the source vendor row is untouched.
    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.3.3',
      only: [meta.id],
    });
    expect(
      await t.run((ctx) => ctx.db.query('contacts').collect()),
    ).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query('vendors').collect()),
    ).toHaveLength(1);
  });
});
