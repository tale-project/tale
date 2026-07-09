import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import {
  buildModules,
  historicalSchema,
} from '../../../framework/test_helpers';
import { meta } from './meta';

const DIR = 'migrations/versions/v0_3_4/05_backfill_support_case_contact_id';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const ORG = 'org_test_1';

describe('0.3.4/05 backfill_support_case_contact_id', () => {
  it('is a reversible, non-destructive db migration', () => {
    expect(meta.kind).toBe('db');
    expect(meta.reversible).toBe(true);
    expect(meta.destructive).toBe(false);
  });

  it('sets contactId from the customer-migrated contact; is idempotent; down clears it; requester-only cases are skipped', async () => {
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
      return { customerId: custId, contactId: contactRowId };
    });

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });

    const linked = await t.run((ctx) =>
      ctx.db
        .query('supportCases')
        .withIndex('by_customer', (q) => q.eq('customerId', customerId))
        .collect(),
    );
    expect(linked[0].contactId).toBe(contactId);

    // The requester-only case gains no contactId.
    const anon = await t.run((ctx) =>
      ctx.db
        .query('supportCases')
        .withIndex('by_customer', (q) => q.eq('customerId', undefined))
        .collect(),
    );
    expect(anon).toHaveLength(1);
    expect(anon[0].contactId).toBeUndefined();

    // Idempotent.
    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });

    // Down clears contactId; customerId is untouched.
    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.3.3',
      only: [meta.id],
    });
    const after = await t.run((ctx) =>
      ctx.db
        .query('supportCases')
        .withIndex('by_customer', (q) => q.eq('customerId', customerId))
        .collect(),
    );
    expect(after[0].contactId).toBeUndefined();
    expect(after[0].customerId).toBe(customerId);
  });
});
