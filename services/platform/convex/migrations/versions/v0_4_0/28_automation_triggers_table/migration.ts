/**
 * 0.4.0 / 28 — introduce `workflowTriggers`, what starts an automation.
 *
 * One row per automation, holding the kind (schedule, webhook, event, api-key)
 * and only what that kind needs: a cron expression and its timezone, the hash
 * of a webhook token (never the token itself), or a platform event name. The
 * binding is to the automation NAME rather than to a version, so promoting a
 * new version never invalidates a URL or a schedule someone else depends on.
 *
 * The table is introduced EMPTY. Triggers are re-created deliberately: a
 * webhook token is shown once at creation and only its hash is stored, so an
 * inherited row could not be honoured anyway.
 *
 * There is nothing to transform forward — a purely additive table cannot be
 * replayed against today's schema (Convex validates existing rows at push
 * time) — so `up` is a documented no-op. `down` removes rows so a deployment
 * rolled back past this release, whose schema does not declare the table,
 * validates.
 *
 * Reference-only: the runner never executes this; the handlers exist so the
 * documented history stays under round-trip test.
 */

import { defineReferenceMigration } from '../../../framework/define';

export const migration = defineReferenceMigration({
  title: 'Introduce the workflowTriggers table',
  description:
    'Introduces the workflowTriggers table holding what starts an automation (schedule, webhook, event or api-key), bound to the automation name so a redeploy never invalidates a webhook URL. up is a documented no-op because the table is introduced empty; down deletes any rows so a deployment rolled back past this release re-validates against a schema that does not declare the table.',
  destructive: false,
  snapshot: 'none',
  table: 'workflowTriggers',

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
