/**
 * Backfill conversation contact source.
 *
 * Email ingest auto-creates a contact for every conversation correspondent,
 * but it stamped those rows as `manual_import`. The Source column and details
 * dialog then claimed every inbox-born contact was typed in by hand.
 *
 * Provenance was already written into metadata (`createdFrom: email_sync` or
 * `sent_email_sync`). `up` flips `source` to `conversation` for those rows so
 * the UI matches how the contact actually arrived. True manual imports and
 * file uploads have no such metadata and stay untouched.
 *
 * `down` restores `manual_import` on the same predicate, so a rollback lands
 * the pre-fix shape. Both directions are idempotent: a replayed batch that
 * already carries the target source is a no-op. Nothing is destroyed, so
 * `snapshot: 'none'` is enough.
 */

import type { GenericId } from 'convex/values';

import { defineDbMigration } from '../../../framework/define';

const EMAIL_CREATED_FROM = new Set(['email_sync', 'sent_email_sync']);

function createdFromEmail(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  const createdFrom = (metadata as { createdFrom?: unknown }).createdFrom;
  return typeof createdFrom === 'string' && EMAIL_CREATED_FROM.has(createdFrom);
}

export const migration = defineDbMigration({
  title: 'Backfill conversation contact source',
  description:
    'up rewrites contacts auto-created from email sync from manual_import to conversation; down restores those rows to manual_import when metadata.createdFrom is email_sync or sent_email_sync',
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['contacts'] },
  table: 'contacts',

  async up(ctx, doc) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the runner paginates `table: 'contacts'`
    const id = doc._id as GenericId<'contacts'>;
    if (doc.source !== 'manual_import') return;
    if (!createdFromEmail(doc.metadata)) return;
    await ctx.db.patch(id, { source: 'conversation' });
  },

  async down(ctx, doc) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above
    const id = doc._id as GenericId<'contacts'>;
    if (doc.source !== 'conversation') return;
    if (!createdFromEmail(doc.metadata)) return;
    await ctx.db.patch(id, { source: 'manual_import' });
  },
});
