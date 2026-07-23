/**
 * 0.4.0 / 27 — introduce `workflowDeployments`, the one live version per
 * automation.
 *
 * Promotion is a separate act from saving, so it is a separate row: at most one
 * per (organization, automation), rewritten in place when a version is promoted
 * or rolled back. Keeping it out of the version history is what makes both
 * operations single writes that never touch what already happened.
 *
 * The table is introduced EMPTY — an automation is deployed by an explicit act
 * after this release, and a deployment that has not happened yet is simply an
 * absent row.
 *
 * There is nothing to transform forward — a purely additive table cannot be
 * replayed against today's schema (Convex validates existing rows at push
 * time) — so `up` is a documented no-op. `down` removes rows so a deployment
 * rolled back past this release, whose schema does not declare the table,
 * validates; nothing durable is lost, since a deployment is re-made by
 * promoting the version again.
 *
 * Reference-only: the runner never executes this; the handlers exist so the
 * documented history stays under round-trip test.
 */

import { defineReferenceMigration } from '../../../framework/define';

export const migration = defineReferenceMigration({
  title: 'Introduce the workflowDeployments live-version table',
  description:
    'Introduces the workflowDeployments table holding at most one row per (organization, automation) naming the single version that triggers run. up is a documented no-op because the table is introduced empty; down deletes any rows so a deployment rolled back past this release re-validates against a schema that does not declare the table.',
  destructive: false,
  snapshot: 'none',
  table: 'workflowDeployments',

  async up(_ctx, _doc) {
    // No-op: the table is introduced empty and only the automation store
    // writes it, so there is no forward transform to replay.
  },

  async down(ctx, doc) {
    // Drop the row so the world re-validates against the pre-change schema.
    // Guarded by a read: deleting an already-deleted id throws, and a second
    // pass over the same rows must be a no-op.
    // oxlint-disable-next-line typescript/no-explicit-any -- MigrationDoc ids are table-agnostic
    const db = ctx.db as any;
    const existing = await db.get(doc._id);
    if (!existing) return;
    await db.delete(doc._id);
  },
});
