import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import {
  buildModules,
  historicalSchema,
} from '../../../framework/test_helpers';
import { meta } from './meta';

const DIR = 'migrations/versions/v0_3_4/04_backfill_conversation_contact_id';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const ORG = 'org_test_1';

describe('0.3.4/04 backfill_conversation_contact_id', () => {
  it('is a reversible, non-destructive db migration', () => {
    expect(meta.kind).toBe('db');
    expect(meta.reversible).toBe(true);
    expect(meta.destructive).toBe(false);
  });

  it('sets contactId from the customer-migrated contact; is idempotent; down clears it and leaves customerId', async () => {
    const t = convexTest(historicalSchema, modules);
    const { customerId, contactId } = await t.run(async (ctx) => {
      const custId = await ctx.db.insert('customers', {
        organizationId: ORG,
        email: 'jane@buyer.test',
        status: 'active',
        source: 'manual_import',
      });
      const contactRowId = await ctx.db.insert('contacts', {
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
      return { customerId: custId, contactId: contactRowId };
    });

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });

    let convs = await t.run((ctx) => ctx.db.query('conversations').collect());
    expect(convs[0].contactId).toBe(contactId);
    expect(convs[0].customerId).toBe(customerId);

    // Idempotent.
    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });
    convs = await t.run((ctx) => ctx.db.query('conversations').collect());
    expect(convs[0].contactId).toBe(contactId);

    // Down clears contactId; customerId is untouched.
    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.3.3',
      only: [meta.id],
    });
    convs = await t.run((ctx) => ctx.db.query('conversations').collect());
    expect(convs[0].contactId).toBeUndefined();
    expect(convs[0].customerId).toBe(customerId);
  });
});
