/**
 * 0.4.0 / 29 — introduce `workflowRuns`, the durable record of one execution.
 *
 * The row is written before the first node runs and updated as the run
 * progresses: `checkpoints` holds each completed node's output, which is what
 * lets a run that hits the action time window resume at the next node instead
 * of repeating the side effects of the ones already done. `trace` and
 * `effects` keep the engine's own result shape, so the canvas can overlay the
 * last run and an effect stays auditable afterwards.
 *
 * The table is introduced EMPTY. A run is a record of something that happened
 * on a specific version of a specific automation; the retired execution rows
 * describe a different model and are dropped by their own migrations rather
 * than reinterpreted here.
 *
 * There is nothing to transform forward — a purely additive table cannot be
 * replayed against today's schema (Convex validates existing rows at push
 * time) — so `up` is a documented no-op. `down` removes rows so a deployment
 * rolled back past this release, whose schema does not declare the table,
 * validates. Only history is lost, and only for runs performed after this
 * release: an in-flight run rolled back this way stops where it stopped, which
 * its checkpoints record.
 *
 * Reference-only: the runner never executes this; the handlers exist so the
 * documented history stays under round-trip test.
 */

import { defineReferenceMigration } from '../../../framework/define';

export const migration = defineReferenceMigration({
  title: 'Introduce the workflowRuns durable run table',
  description:
    'Introduces the workflowRuns table holding one row per execution with its per-node checkpoints, trace and effects, which is what lets an interrupted run resume instead of repeating side effects. up is a documented no-op because the table is introduced empty; down deletes any rows so a deployment rolled back past this release re-validates against a schema that does not declare the table.',
  destructive: false,
  snapshot: 'none',
  table: 'workflowRuns',

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
