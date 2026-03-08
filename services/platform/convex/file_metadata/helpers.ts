import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/**
 * Delete a storage blob and its associated fileMetadata record.
 * Silently skips the metadata deletion if no record exists.
 */
export async function deleteStorageWithMetadata(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
): Promise<void> {
  await ctx.storage.delete(storageId);

  const metadata = await ctx.db
    .query('fileMetadata')
    .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
    .first();

  if (metadata) {
    await ctx.db.delete(metadata._id);
  }
}
