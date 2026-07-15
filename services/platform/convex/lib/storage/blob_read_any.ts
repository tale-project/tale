/**
 * Backend-aware blob reads for ANY action runtime — V8-safe (no `node:*`
 * imports), so V8 actions and runtime-ambiguous helpers can consume a blob
 * reference without pulling in the `'use node'` seam (`blob_access.ts`).
 *
 * A Convex `_storage` id resolves through `ctx.storage` exactly as before; an
 * `s3:` ref hops through the node `presignBlobGet` internal action (S3 signing
 * needs node) and comes back as a short-lived presigned URL any runtime can
 * `fetch`. Callers that hold a node ActionCtx and want raw bytes should prefer
 * `readBlobBytes` from `blob_access.ts` — this module is for the URL shape.
 */

import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { convexStorageId, isS3Ref, type BlobRef } from './blob_ref';

/**
 * A short-lived URL the CURRENT SERVER runtime can `fetch` for a blob's bytes.
 * Convex refs return the internal storage URL (backend-reachable, as today);
 * `s3:` refs return a presigned GET against the org's bucket. `null` when the
 * blob is missing or the org can't be resolved — callers treat that as
 * "not found" (their existing null path).
 */
export async function getBlobFetchUrl(
  ctx: ActionCtx,
  organizationId: string,
  ref: BlobRef,
): Promise<string | null> {
  if (isS3Ref(ref)) {
    return await ctx.runAction(internal.files.blob_actions.presignBlobGet, {
      organizationId,
      ref: String(ref),
    });
  }
  const convexId = convexStorageId(ref);
  if (convexId === null) return null;
  return await ctx.storage.getUrl(convexId);
}

/**
 * Backend-aware byte read for ANY action runtime. Convex refs stream from
 * `ctx.storage.get` (unchanged); `s3:` refs fetch the presigned URL minted
 * above. Returns `null` when the blob is missing (matching the null contract
 * of `ctx.storage.get`).
 */
export async function fetchBlobArrayBuffer(
  ctx: ActionCtx,
  organizationId: string,
  ref: BlobRef,
): Promise<{ bytes: ArrayBuffer; contentType: string | null } | null> {
  const convexId = convexStorageId(ref);
  if (convexId !== null) {
    const blob = await ctx.storage.get(convexId);
    if (blob === null) return null;
    return { bytes: await blob.arrayBuffer(), contentType: blob.type || null };
  }
  const url = await getBlobFetchUrl(ctx, organizationId, ref);
  if (url === null) return null;
  const response = await fetch(url);
  if (!response.ok) {
    console.warn(
      `[fetchBlobArrayBuffer] presigned fetch failed (${response.status}) for ${String(ref)}`,
    );
    return null;
  }
  return {
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get('content-type'),
  };
}
