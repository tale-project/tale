/**
 * Reference migration: teardown of the customers+vendors → contacts merge
 * (issue #2618). Documents the representative field-level shape change —
 * `conversations` losing `customerId` — under round-trip test. `up` unsets
 * `customerId` (the link already lives on `contactId` post-0.3.4/04); `down`
 * structurally restores the field with a placeholder (the original id is
 * unrecoverable). The runner never executes a `reference` migration; the test
 * calls `up`/`down` directly. The table drops (customers, vendors) and the
 * `status` / `supportCases.customerId` removals ship with the same release —
 * see meta.
 */

import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

const PLACEHOLDER_CUSTOMER_ID = 'migrated-to-contact';

export const migration: DbMigration = {
  meta,
  table: 'conversations',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
    if (doc.customerId === undefined) return; // already migrated
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy field absent from schema
    await (ctx.db as any).patch(doc._id, { customerId: undefined });
  },

  async down(ctx: MutationCtx, doc: MigrationDoc) {
    if (doc.customerId !== undefined) return; // already restored
    // Structural reversal only: the original customerId is unrecoverable (the
    // customers table is gone; contactId is the forward replacement).
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy field absent from schema
    await (ctx.db as any).patch(doc._id, {
      customerId: PLACEHOLDER_CUSTOMER_ID,
    });
  },
};
