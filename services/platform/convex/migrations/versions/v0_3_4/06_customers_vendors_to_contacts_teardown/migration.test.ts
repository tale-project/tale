import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration } from './index';

const DIR =
  'migrations/versions/v0_3_4/06_customers_vendors_to_contacts_teardown';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

// Local fixture with the pre-teardown conversations shape (customerId present
// alongside its contactId replacement). Both optional so both shapes validate.
const fixtureSchema = defineSchema({
  conversations: defineTable({
    organizationId: v.string(),
    contactId: v.optional(v.string()),
    customerId: v.optional(v.string()),
  }).index('by_organizationId', ['organizationId']),
});

describe('0.3.4/06 customers_vendors_to_contacts_teardown (reference)', () => {
  it('up drops customerId; down structurally restores it; idempotent', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run((ctx) =>
      ctx.db.insert('conversations', {
        organizationId: 'org_1',
        contactId: 'contact_1',
        customerId: 'customer_1',
      }),
    );

    const runUp = async () => {
      await t.run(async (ctx) => {
        for (const d of await ctx.db.query('conversations').collect()) {
          await migration.up(ctx, d as never);
        }
      });
    };

    await runUp();
    let rows = await t.run((ctx) => ctx.db.query('conversations').collect());
    expect(rows[0].customerId).toBeUndefined();
    expect(rows[0].contactId).toBe('contact_1');

    // up again is a no-op.
    await runUp();
    rows = await t.run((ctx) => ctx.db.query('conversations').collect());
    expect(rows[0].customerId).toBeUndefined();

    // down structurally restores the field (placeholder — the original id is
    // unrecoverable once the customers table is gone).
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('conversations').collect()) {
        await migration.down(ctx, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('conversations').collect());
    expect(rows[0].customerId).toBe('migrated-to-contact');
  });
});
