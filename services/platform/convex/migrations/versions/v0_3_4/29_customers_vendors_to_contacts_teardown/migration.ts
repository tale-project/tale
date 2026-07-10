/**
 * 0.3.4 / 29 — teardown of the Customers + Vendors → Contacts merge (issue
 * #2618). Records the schema-shape removals that land with this release:
 *  - the `customers` and `vendors` tables are dropped (their rows were copied
 *    into `contacts` by 0.3.4/22 + 0.3.4/23),
 *  - `conversations.customerId` / `supportCases.customerId` leave the schema
 *    (repointed to `contactId` by 0.3.4/24 + 0.3.4/25 and CLEARED from
 *    existing rows by the runnable 0.3.4/27 + 0.3.4/28),
 *  - the customer-only `status` field goes with the `customers` table.
 *
 * Convex validates existing rows against the new schema at push time, so the
 * TABLE drops cannot be replayed — hence `reference` (the runner never
 * executes it). The forward/inverse transform below documents the
 * representative field-level change (`conversations` losing `customerId`)
 * and stays under round-trip test; the executable, stamp-reversible version
 * of that clear lives in 0.3.4/27 + 0.3.4/28.
 */

import type { Id } from '../../../../_generated/dataModel';
import { defineReferenceMigration } from '../../../framework/define';

const PLACEHOLDER_CUSTOMER_ID = 'migrated-to-contact';

export const migration = defineReferenceMigration({
  title:
    'Drop customers + vendors tables and conversation/support-case customerId',
  description:
    'Teardown of the customers+vendors → contacts merge (#2618): drops the ' +
    'customers and vendors tables (rows copied to contacts by 22/23) and the ' +
    'customerId link on conversations/supportCases (repointed to contactId ' +
    'by 24/25, cleared from rows by 27/28); the customer-only status field ' +
    'goes with the customers table. The documented up unsets customerId; ' +
    'down structurally restores a placeholder (the runnable 27/28 restore ' +
    'the real value via the contact __migratedFrom stamp).',
  destructive: true,
  snapshot: 'none',
  table: 'conversations',

  async up(ctx, doc) {
    if (doc.customerId === undefined) return; // already migrated
    await ctx.db.patch(
      doc._id as Id<'conversations'>,
      {
        // oxlint-disable-next-line typescript/no-explicit-any -- legacy field absent from schema
        customerId: undefined,
      } as any,
    );
  },

  async down(ctx, doc) {
    if (doc.customerId !== undefined) return; // already restored
    // Structural reversal only: this documentation transform cannot recover
    // the original id — 0.3.4/27 owns the stamp-based recovery.
    await ctx.db.patch(
      doc._id as Id<'conversations'>,
      {
        // oxlint-disable-next-line typescript/no-explicit-any -- legacy field absent from schema
        customerId: PLACEHOLDER_CUSTOMER_ID,
      } as any,
    );
  },
});
