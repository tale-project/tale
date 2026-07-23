/**
 * 0.4.0 / 26 — introduce `workflows`, the immutable version history of an
 * organization's automations.
 *
 * One row per saved version: the authored document exactly as written, the
 * contiguous version number, and whether the version's own acceptance tests
 * passed (the fact the deploy gate reads). Nothing rewrites a row — a change to
 * an automation appends the next version — which is what makes a run
 * reproducible against the document that produced it.
 *
 * The table is introduced EMPTY. The automation store that replaces the retired
 * one-mutable-document-per-automation model starts from nothing rather than
 * carrying old rows forward: the retired shape had no version identity to map
 * onto, and its documents are converted by the authoring tools rather than by a
 * data migration.
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
  title: 'Introduce the workflows automation-version table',
  description:
    'Introduces the workflows table holding one immutable row per saved automation version (org-scoped name, contiguous version, the authored document, whether its tests passed). up is a documented no-op because the table is introduced empty; down deletes any rows so a deployment rolled back past this release re-validates against a schema that does not declare the table.',
  destructive: false,
  snapshot: 'none',
  table: 'workflows',

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
