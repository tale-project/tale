/**
 * Reference migration: add `usageLedger.apiKeyId` + the `apiKey` budget scope.
 *
 * The change is purely additive (a new optional field + a widened enum), so
 * `up` is a documented no-op — every historical row is already valid under the
 * new schema and no attribution can be reconstructed for pre-change rows. `down`
 * drops `apiKeyId` from a `usageLedger` row so it re-validates against the
 * pre-change schema (which had no such field). Both are idempotent. The runner
 * never executes a `reference` migration; the test calls `up`/`down` directly.
 */

import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

export const migration: DbMigration = {
  meta,
  table: 'usageLedger',

  async up(_ctx: MutationCtx, _doc: MigrationDoc) {
    // No-op: `apiKeyId` is a NEW optional column. Historical rows have no key
    // attribution and none can be reconstructed, so there is nothing to
    // backfill. Only new openai-compat writes populate the field. Kept explicit
    // + idempotent.
  },

  async down(ctx: MutationCtx, doc: MigrationDoc) {
    // Drop the new column so the row re-validates against the pre-change schema
    // (which had no `apiKeyId`). Absent already → nothing to do (idempotent).
    if (doc.apiKeyId === undefined) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- new optional field absent from the pre-change Doc type
    await (ctx.db as any).patch(doc._id, { apiKeyId: undefined });
  },
};
