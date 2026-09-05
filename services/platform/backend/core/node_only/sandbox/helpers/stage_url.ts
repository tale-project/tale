/**
 * Resolve a blob reference to a URL the in-container runnerd daemon can fetch
 * — the ONE way any workspace/input blob gets staged into a session by URL:
 * an org-bucket `s3:` ref becomes the token-gated `/api/sandbox-blob` stream
 * route (the sandbox net has no route to the bucket, and a presigned bucket
 * URL must never enter the container).
 *
 * Returns `null` when the blob cannot be staged by URL: the deployment has
 * no HMAC root to sign a stage token with, or the ref is not an `s3:` ref
 * (a legacy Convex `_storage` id from before the cutover — that backend is
 * retired, so its bytes are gone). Callers own the skip-vs-fail policy (chat
 * run_code additionally keeps a bounded inline-base64 fallback lane — see
 * session_exec.ts).
 */

import { isS3Ref } from '../../../lib/storage/blob_ref';
import { buildSandboxBlobStageUrl } from '../../../lib/storage/sandbox_stage_token';

export async function stageUrlForBlobRef(
  ref: string,
  organizationId: string,
): Promise<string | null> {
  if (!isS3Ref(ref)) {
    console.warn(
      `[stage_url] blob ref "${ref}" is not an s3: reference and cannot be staged — the Convex _storage backend is retired`,
    );
    return null;
  }
  return buildSandboxBlobStageUrl(ref, organizationId);
}
