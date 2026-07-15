import { internal } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import { convexStorageId, type BlobRef } from '../lib/storage/blob_ref';

/**
 * Delete a storage blob and its associated fileMetadata record.
 * Silently skips the metadata deletion if no record exists.
 *
 * Backend-aware: a Convex `_storage` id is deleted inline; an `s3:` ref lives in
 * the org's own bucket and can't be signed from a mutation, so its physical
 * delete is scheduled onto the node `deleteOrgBlobs` action (best-effort). The
 * fileMetadata row (which carries the owning org) is removed either way.
 */
export async function deleteStorageWithMetadata(
  ctx: MutationCtx,
  storageId: BlobRef,
): Promise<void> {
  const metadata = await ctx.db
    .query('fileMetadata')
    .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
    .first();

  const convexId = convexStorageId(storageId);
  if (convexId !== null) {
    await ctx.storage.delete(convexId);
  } else if (metadata) {
    await ctx.scheduler.runAfter(
      0,
      internal.files.blob_actions.deleteOrgBlobs,
      { organizationId: metadata.organizationId, refs: [String(storageId)] },
    );
  }

  if (metadata) {
    await ctx.db.delete(metadata._id);
  }
}
