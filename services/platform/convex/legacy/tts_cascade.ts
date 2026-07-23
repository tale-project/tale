/**
 * LEGACY-DATA cascade — home `convex/legacy/`.
 *
 * the chat rebuild replaces this with the chat rebuild cascade; until then, the
 * member-removal personalization cascade
 * (`lib/cascades/personalization_cascade.ts::cascadeOnMemberRemoved`) depends
 * on `cascadeOnTtsForMemberRemoved` below to purge a departing member's TTS
 * audio (GDPR Art 17).
 *
 * A byte-faithful copy (this one function + its shared `PAGE_SIZE`
 * constant only) of the retired `tts/cascade_helpers.ts`. Two exports from
 * the original file are intentionally NOT restored here:
 *
 *   - `cascadeDeleteMessageChildren` — only ever called from
 *     `threads/mutations.ts` (arena Thread-B-loses cleanup), which is
 *     retired in full. Neither this
 *     module's own `cascadeOnTtsForMemberRemoved` nor the restored
 *     `../legacy/thread_cascade.ts::cascadeDeleteThreadChildren` calls it —
 *     it has no live caller, so it stays retired until the chat rebuild.
 *   - `gcOrgTtsChunks` — the hourly org-sweep cron mutation. Explicitly out
 *     of scope for this restore; returns with the chat rebuild.
 */

import type { MutationCtx } from '../_generated/server';
import {
  deleteBlobInMutation,
  scheduleS3BlobDeletes,
} from '../lib/storage/blob_delete';

const PAGE_SIZE = 200;

/**
 * GDPR Art 17 erasure path for a single user-org pair. Called from
 * `cascadeOnMemberRemoved` so a member whose synthesis history spans many
 * threads is fully erased without leaving verbatim voice renderings on
 * disk. Uses the `by_user_org` index introduced in commit 2 — legacy rows
 * that pre-date the `userId` column are reaped by the daily cron as a
 * defence-in-depth.
 */
export async function cascadeOnTtsForMemberRemoved(
  ctx: MutationCtx,
  userId: string,
  organizationId: string,
): Promise<{ deleted: number }> {
  let deleted = 0;
  const s3Refs: string[] = [];
  // Cap the scan at 30 pages (×200 = 6K writes) to stay under Convex's
  // ~8K per-mutation write budget. Whatever doesn't fit gets reaped by
  // the daily cron — still inside the 30-day Art 12(3) window.
  for (let i = 0; i < 30; i++) {
    const page = await ctx.db
      .query('ttsAudioChunks')
      .withIndex('by_user_org', (q) =>
        q.eq('userId', userId).eq('organizationId', organizationId),
      )
      .take(PAGE_SIZE);
    if (page.length === 0) break;
    for (const row of page) {
      // db.delete before the blob delete: Convex `_storage` writes are
      // out-of-band and not rolled back on transaction abort, so the
      // reverse order can leave a row pointing at a dead storageId. This
      // order guarantees a `db.delete` failure aborts cleanly with both
      // row+blob intact; a later blob-delete failure only leaks a blob
      // (swept by the daily `gcOrgTtsChunks` cron as defence-in-depth).
      // Origin: the retired `tts/cascade_helpers.ts`
      // (`cascadeDeleteMessageChildren`, not restored here — see header).
      await ctx.db.delete(row._id);
      if (row.storageId) {
        await deleteBlobInMutation(
          ctx,
          row.storageId,
          s3Refs,
          'tts.cascadeOnTtsForMemberRemoved',
        );
      }
      deleted += 1;
    }
    if (page.length < PAGE_SIZE) break;
  }
  await scheduleS3BlobDeletes(ctx, organizationId, s3Refs);
  return { deleted };
}
