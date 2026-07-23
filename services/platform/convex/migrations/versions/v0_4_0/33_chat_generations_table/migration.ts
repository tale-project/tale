/**
 * 0.4.0 / 33 — introduce `generations`, the in-flight turn.
 *
 * Exactly one row exists per actively generating thread, so its PRESENCE is the is-generating signal and no thread row carries stale generation state. `heartbeatAt` is what lets a sweeper tell a live stream from a crashed one.
 *
 * The table is introduced EMPTY. There is nothing to transform forward — a
 * purely additive table cannot be replayed against today's schema (Convex
 * validates existing rows at push time) — so `up` is a documented no-op.
 * `down` removes rows so a deployment rolled back past this release, whose
 * schema does not declare the table, still validates.
 *
 * Reference-only: the runner never executes this; the handlers exist so the
 * documented history stays under round-trip test.
 */

import { defineReferenceMigration } from '../../../framework/define';

export const migration = defineReferenceMigration({
  title: 'Introduce the generations chat table',
  description:
    'Introduces the generations table holding the in-flight turn for a thread, whose presence is the is-generating signal. up is a documented no-op because the table is introduced empty; down deletes any rows so a deployment rolled back past this release re-validates against a schema that does not declare the table.',
  destructive: false,
  snapshot: 'none',
  table: 'generations',

  async up(_ctx, _doc) {
    // No-op: the table is introduced empty and only the chat layer writes it,
    // so there is no forward transform to replay.
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
