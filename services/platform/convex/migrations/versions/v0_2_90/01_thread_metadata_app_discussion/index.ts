/**
 * Reference migration: add the `threadMetadata` kind `'app_discussion'` plus
 * its `appSlug`/`subjectType`/`subjectId` columns (+ `by_org_app_subject`).
 *
 * The change is purely additive (a widened enum + new optional fields), so
 * `up` is a documented no-op — every historical row is already valid under
 * the new schema and no app-subject attribution can be reconstructed for
 * pre-change rows. `down` strips the new columns and clears a
 * `kind: 'app_discussion'` so the row re-validates against the pre-change
 * schema (which had neither); the thread degrades to a plain owner-only chat
 * without losing its messages. Both are idempotent. The runner never executes
 * a `reference` migration; the test calls `up`/`down` directly.
 */

import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

export const migration: DbMigration = {
  meta,
  table: 'threadMetadata',

  async up(_ctx: MutationCtx, _doc: MigrationDoc) {
    // No-op: `appSlug`/`subjectType`/`subjectId` are NEW optional columns and
    // `'app_discussion'` is a NEW kind literal. Historical rows carry no
    // app-subject attribution and none can be reconstructed, so there is
    // nothing to backfill. Only `getOrCreateAutomationThread` writes the new shape.
    // Kept explicit + idempotent.
  },

  async down(ctx: MutationCtx, doc: MigrationDoc) {
    // Strip the new columns + kind literal so the row re-validates against
    // the pre-change schema. Absent already → nothing to do (idempotent).
    const clearsKind = doc.kind === 'app_discussion';
    if (
      doc.appSlug === undefined &&
      doc.subjectType === undefined &&
      doc.subjectId === undefined &&
      !clearsKind
    ) {
      return;
    }
    // `appSlug` was renamed out of the live schema by the later apps→automations
    // cutover; this historical migration still clears the pre-change column, so
    // the write is untyped (`as any`) — matching `v0_2_88/01`'s convention.
    // oxlint-disable-next-line typescript/no-explicit-any -- field absent from the current schema
    await (ctx.db as any).patch(doc._id, {
      appSlug: undefined,
      subjectType: undefined,
      subjectId: undefined,
      ...(clearsKind ? { kind: undefined } : {}),
    });
  },
};
