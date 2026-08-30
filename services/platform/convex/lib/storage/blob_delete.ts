/**
 * Backend-aware blob deletion from MUTATIONS (V8) — the delete counterpart of
 * `blob_ref.ts`. A Convex `_storage` id keeps today's inline `ctx.storage.delete`
 * (best-effort, logged); an `s3:` ref lives in the org's own bucket and a
 * mutation cannot sign an S3 request, so its physical delete is batched and
 * handed to the scheduled node lane (`internal.files.blob_actions.deleteOrgBlobs`,
 * idempotent + best-effort). Callers in a loop collect S3 refs with
 * `deleteBlobInMutation` and flush ONCE with `scheduleS3BlobDeletes` so a large
 * cascade doesn't schedule hundreds of actions.
 *
 * NOT importable from schema files (pulls in `_generated/api`); mutations,
 * queries, and actions are all fine.
 */

import type { MutationCtx } from '../ctx';
import { internal } from '../handler_names';
import { convexStorageId, type BlobRef } from './blob_ref';

/**
 * Delete one blob reference from a mutation. Convex ids delete inline
 * (identical to the previous per-site behaviour — failures are logged, never
 * thrown, so a missing blob can't abort the caller's transaction); `s3:` refs
 * are pushed onto `s3Refs` for a single batched schedule via
 * {@link scheduleS3BlobDeletes} after the caller's loop.
 */
export async function deleteBlobInMutation(
  ctx: MutationCtx,
  ref: BlobRef,
  s3Refs: string[],
  label: string,
): Promise<void> {
  const convexId = convexStorageId(ref);
  if (convexId === null) {
    s3Refs.push(String(ref));
    return;
  }
  try {
    await ctx.storage.delete(convexId);
  } catch (err) {
    console.warn(
      `[${label}] storage.delete failed for ${String(ref)}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Fire-and-forget the physical S3 deletes collected by
 * {@link deleteBlobInMutation}. No-op when the batch is empty. Scheduling from
 * a mutation is transactional — if the caller's transaction aborts, no delete
 * is scheduled, so the blobs stay consistent with the surviving rows.
 */
export async function scheduleS3BlobDeletes(
  ctx: MutationCtx,
  organizationId: string,
  s3Refs: readonly string[],
): Promise<void> {
  if (s3Refs.length === 0) return;
  await ctx.scheduler.runAfter(0, internal.files.blob_actions.deleteOrgBlobs, {
    organizationId,
    refs: [...s3Refs],
  });
}

/**
 * Single-ref convenience: inline-delete a Convex id, or immediately schedule
 * the S3 lane for an `s3:` ref. Use the collect + flush pair instead when
 * deleting inside a loop.
 */
export async function deleteOrgBlobInMutation(
  ctx: MutationCtx,
  organizationId: string,
  ref: BlobRef,
  label: string,
): Promise<void> {
  const s3Refs: string[] = [];
  await deleteBlobInMutation(ctx, ref, s3Refs, label);
  await scheduleS3BlobDeletes(ctx, organizationId, s3Refs);
}
