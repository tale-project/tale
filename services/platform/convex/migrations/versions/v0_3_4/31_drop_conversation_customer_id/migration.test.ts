// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_3_4/31_drop_conversation_customer_id';
const ORG = 'org_test_1';

// The harness runs the full ritual automatically: up through the real runner,
// TRUE handler idempotency over migrated state, digest-equal down (the seeded
// world must come back byte-for-byte), ledger transitions, snapshot hygiene,
// and the destructive gate. This file provides DATA + migration-specific truth.
defineMigrationTest({
  id: '0.3.4/31_drop_conversation_customer_id',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    // The realistic frontier this migration actually runs at: 0.3.4/27
    // already cleared customerId on any row it could repoint (contactId set).
    // up must leave this row untouched — it is not the residual shape 31
    // exists for — and the automatic round-trip proves down does too.
    const contactId = await ctx.db.insert('contacts', {
      organizationId: ORG,
      email: 'jane@buyer.test',
      source: 'manual_import',
    });
    await ctx.db.insert('conversations', {
      organizationId: ORG,
      contactId,
      status: 'open',
    });
  },

  async expectUp(world) {
    const convs = (await world.run((ctx) =>
      ctx.db.query('conversations').collect(),
    )) as Array<Record<string, unknown>>;
    expect(convs).toHaveLength(1);
    expect(convs[0].customerId).toBeUndefined();
    expect(convs[0].contactId).toBeDefined();
  },

  cases: {
    // The row 0.3.4/27 could never touch, and the actual reason this
    // migration exists: customerId with no contactId at all (the referenced
    // customer/vendor was hard-deleted before 0.3.4/22-23 ever ran, so no
    // contact — and no recovery stamp — exists). 31 must still clear it so
    // the schema drop is safe; down has nothing to restore from, which is an
    // accepted, narrow, irreversible edge case (the data was already
    // unrecoverable before this migration touched it — 0.3.4/27 reached the
    // same conclusion and left it alone).
    'unresolvable customerId (no contactId, no contact to stamp-match)': async (
      world,
    ) => {
      const orphanId = await world.run((ctx) =>
        ctx.db.insert('conversations', {
          organizationId: ORG,
          customerId: 'customer_vanished_before_backfill',
          status: 'open',
        }),
      );

      await world.applyUpOnly();
      let orphan = await world.run((ctx) => ctx.db.get(orphanId));
      expect((orphan as Record<string, unknown> | null)?.customerId).toBe(
        undefined,
      );

      await world.applyDownOnly();
      orphan = await world.run((ctx) => ctx.db.get(orphanId));
      expect((orphan as Record<string, unknown> | null)?.customerId).toBe(
        undefined,
      );
    },
  },
});
