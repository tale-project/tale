/**
 * Backfill mail attachment arrival times.
 *
 * `mailReceivedAt` is what puts an emailed attachment into
 * `by_organizationId_and_mailReceivedAt`, the index the attachment listing
 * walks. Convex has no partial indexes, so a field present only on bound rows
 * is what makes that index mail-only — and a bound row without it is invisible
 * to the listing entirely.
 *
 * Rows bound before the field existed carry no arrival time. The binder
 * back-fills one whenever it touches a row again, but a conversation that has
 * gone quiet is never revisited, so those attachments would stay unlistable for
 * good. That is what this closes.
 *
 * `up` stamps the row's own creation time. The mail's true date is not
 * recoverable here — it lives in the message metadata, and reading it per row
 * would make a per-row transform fan out across another table — and on a live
 * sync the two are within minutes of each other. Going forward the binder
 * prefers the mail's date; this is the best available for history.
 *
 * `down` clears the field only where it equals the row's creation time — the
 * exact value `up` writes. That is what makes it an inverse rather than a
 * blanket wipe: a stamp the binder wrote from the mail's own date is somebody
 * else's data and survives. The chain suite caught the blanket version, because
 * clearing a stamp the seeded world already carried did not restore that world.
 *
 * Both directions are idempotent: `up` skips a row that already has a stamp,
 * `down` skips a row that has none, so a replayed batch is a no-op. Nothing is
 * destroyed in either direction, which is why `snapshot: 'none'` is sufficient.
 */

import type { GenericId } from 'convex/values';

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Backfill mail attachment arrival times',
  description:
    "up stamps mailReceivedAt from the row's creation time on every fileMetadata row that carries a conversationId but no arrival time, so attachments bound before the field existed appear in the mail index; down clears mailReceivedAt on rows carrying a conversationId, restoring the pre-field shape.",
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['fileMetadata'] },
  table: 'fileMetadata',

  async up(ctx, doc) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the runner paginates `table: 'fileMetadata'`, so every doc is a fileMetadata row
    const id = doc._id as GenericId<'fileMetadata'>;
    // Only mail attachments have an arrival time to record.
    if (doc.conversationId === undefined) return;
    // Already stamped: a replayed batch must not churn the row.
    if (typeof doc.mailReceivedAt === 'number') return;
    // `doc` is a generic document, so the creation time arrives untyped.
    const createdAt = doc._creationTime;
    if (typeof createdAt !== 'number') return;
    await ctx.db.patch(id, { mailReceivedAt: createdAt });
  },

  async down(ctx, doc) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above
    const id = doc._id as GenericId<'fileMetadata'>;
    if (doc.conversationId === undefined) return;
    // Clear ONLY what `up` wrote. A stamp that differs from the creation time
    // came from the mail's own date, so it predates this migration or postdates
    // it — either way it is not this migration's to remove.
    if (doc.mailReceivedAt !== doc._creationTime) return;
    await ctx.db.patch(id, { mailReceivedAt: undefined });
  },
});
