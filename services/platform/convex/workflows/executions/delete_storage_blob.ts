/**
 * Simple storage blob deletion handler for scheduled cleanup.
 *
 * Used when an execution's _storageRef is replaced mid-execution —
 * the old blob is orphaned and can be safely deleted after a delay.
 */

import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

export interface DeleteStorageBlobArgs {
  storageId: Id<'_storage'>;
}

export async function deleteStorageBlob(
  ctx: MutationCtx,
  args: DeleteStorageBlobArgs,
): Promise<null> {
  try {
    await ctx.storage.delete(args.storageId);
  } catch {
    // Blob may already be deleted
  }

  return null;
}
