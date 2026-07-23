/**
 * 0.4.0 / 31 — introduce `threads`, the conversation itself.
 *
 * A thread is the unit of branching: forking a conversation creates a new thread pointing at the message it came from, so a fork never mutates the conversation it grew out of.
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
  title: 'Introduce the threads chat table',
  description:
    'Introduces the threads table, one row per conversation, scoped per organization and user. up is a documented no-op because the table is introduced empty; down deletes any rows so a deployment rolled back past this release re-validates against a schema that does not declare the table.',
  destructive: false,
  snapshot: 'none',
  table: 'threads',

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
