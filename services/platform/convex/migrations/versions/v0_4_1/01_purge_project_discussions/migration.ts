/**
 * Purge retired project-discussion threads
 *
 * The project-discussions surface (the Discussions tab under a project) was
 * removed; `threadMetadata.kind` no longer admits `'project_discussion'` and
 * the discussion-only fields (`acceptedAnswerMessageId`, `linkedTaskId`,
 * `unlockedToolGroups`) left the schema. Rows written by the retired surface
 * would fail schema validation on push, so `up` backs each
 * `kind: 'project_discussion'` row up into `migrationSnapshots` and deletes
 * it; every other row is untouched. `down` is the generic snapshot restore —
 * the deleted metadata rows come back byte-for-byte (with fresh `_id`s; no
 * other table stores a `v.id('threadMetadata')` reference).
 *
 * Deliberately NOT cascaded: a discussion's agent-component message bodies
 * and any run threads it spawned are left in place (this migration's subjects
 * stay single-table and its reversibility exact). Those children are ordinary
 * retention-sweep fare, and no released deployment ever carried this surface
 * — only pre-release dev databases hold such rows.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Purge retired project-discussion threads',
  description:
    "up snapshots and deletes every threadMetadata row with kind 'project_discussion' (the retired Discussions surface); down is the generic snapshot restore, rebuilding those rows byte-for-byte.",
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['threadMetadata'] },
  table: 'threadMetadata',

  // Idempotent: a replayed batch sees the row already deleted (the pagination
  // never yields it again) or still present with the discussion kind — the
  // snapshot upsert and delete are both safe to repeat.
  async up(ctx, doc, run) {
    if (doc.kind !== 'project_discussion') return;
    await run.snapshotRow(`threadMetadata:${String(doc._id)}`, doc);
    // MigrationDoc ids are table-erased; the runner guarantees rows come
    // from `table`.
    await ctx.db.delete(doc._id as never);
  },

  // Generic snapshot restore — rows the surviving table holds during `down`
  // were never touched by `up`, so there is nothing to invert per row.
  async down() {},
});
