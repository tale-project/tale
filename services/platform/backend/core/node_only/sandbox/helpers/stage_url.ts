/**
 * Resolve a blob reference to a URL the in-container runnerd daemon can fetch
 * over the sandbox-net `convex` alias — the ONE way any workspace/input blob
 * gets staged into a session by URL:
 *
 * - Convex `_storage` id → its capability URL, origin-rewritten to the alias.
 * - Org-bucket `s3:` ref → the token-gated `/api/sandbox-blob` stream route
 *   (the sandbox net has no route to the bucket, and a presigned bucket URL
 *   must never enter the container).
 *
 * Returns `null` when the blob cannot be staged by URL: the `_storage` bytes
 * are gone, or the deployment has no HMAC root to sign a stage token with.
 * Callers own the skip-vs-fail policy (chat run_code additionally keeps a
 * bounded inline-base64 fallback lane — see session_exec.ts).
 */

import type { ActionCtx } from '../../../lib/ctx';
import { toSandboxStorageUrl } from '../../../lib/helpers/public_storage_url';
import { convexStorageId } from '../../../lib/storage/blob_ref';
import { buildSandboxBlobStageUrl } from '../../../lib/storage/sandbox_stage_token';

export async function stageUrlForBlobRef(
  ctx: Pick<ActionCtx, 'storage'>,
  ref: string,
  organizationId: string,
): Promise<string | null> {
  const cid = convexStorageId(ref);
  if (cid !== null) {
    const raw = await ctx.storage.getUrl(cid);
    return raw === null ? null : toSandboxStorageUrl(raw);
  }
  return buildSandboxBlobStageUrl(ref, organizationId);
}
