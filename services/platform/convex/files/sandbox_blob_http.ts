/**
 * `/api/sandbox-blob` — stream an org-bucket (`s3:`) blob to a sandbox
 * session container.
 *
 * Session containers sit on the SSRF-locked sandbox net: they can reach the
 * Convex http-actions origin via the `convex` alias but have no route to an
 * org's S3/R2 endpoint, and a presigned bucket URL is a bearer credential
 * that must never enter an untrusted container. The staging path therefore
 * hands the in-container daemon THIS route instead: it verifies a short-lived
 * HMAC stage token (see lib/storage/sandbox_stage_token.ts), presigns
 * server-side — `presignBlobGet` re-checks the key sits in the token org's
 * namespace — and passes the upstream body through as a stream (no buffering;
 * a workspace file can be 100 MB).
 *
 * No IP rate limit on purpose: the token gate is strictly stronger (unforgeable,
 * single-blob, minutes-lived), and an IP bucket would throttle a legitimate
 * 100-file staging burst from the one sandbox-relay address.
 */

import { internal } from '../_generated/api';
import { httpAction } from '../_generated/server';
import { isS3Ref } from '../lib/storage/blob_ref';
import { verifyStageToken } from '../lib/storage/sandbox_stage_token';

export const sandboxBlobServeHandler = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return new Response('Missing token', { status: 400 });
  }

  const verdict = await verifyStageToken(token);
  if (!verdict.ok) {
    if (verdict.reason === 'unconfigured') {
      // The deployment carries no HMAC root — it also could not have SIGNED
      // a token, so a request landing here is a config gap, not an attack.
      console.warn(
        '[sandbox-blob] refused: no WEBDAV_APP_PASSWORD_HMAC_KEY to verify with',
      );
      return new Response('Stage tokens unavailable', { status: 503 });
    }
    // malformed / bad_signature / expired all collapse to one status — a
    // forger learns nothing about which check tripped.
    return new Response('Forbidden', { status: 403 });
  }

  const { ref, org } = verdict.payload;
  // `_storage` blobs stage via their own `ctx.storage.getUrl` capability
  // URLs; this route exists solely for the bucket lane.
  if (!isS3Ref(ref)) {
    return new Response('Unsupported ref', { status: 400 });
  }

  // Fail closed as 404 (mirrors `/storage`): presign throws for a key outside
  // the org's namespace and for an org with no object storage configured —
  // neither should leak whether the object exists.
  let presigned: string | null;
  try {
    presigned = await ctx.runAction(
      internal.files.blob_actions.presignBlobGet,
      {
        organizationId: org,
        ref,
      },
    );
  } catch (error) {
    console.warn(
      `[sandbox-blob] presign refused for org ${org}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    presigned = null;
  }
  if (!presigned) {
    return new Response('File not found', { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(presigned);
  } catch (error) {
    console.warn(
      `[sandbox-blob] upstream fetch failed for org ${org}:`,
      error instanceof Error ? error.message : String(error),
    );
    return new Response('Upstream fetch failed', { status: 502 });
  }
  if (!upstream.ok || upstream.body === null) {
    console.warn(
      `[sandbox-blob] upstream returned ${upstream.status} for org ${org}`,
    );
    return new Response('Upstream fetch failed', { status: 502 });
  }

  const headers: Record<string, string> = {
    'Content-Type':
      upstream.headers.get('content-type') ?? 'application/octet-stream',
  };
  // Forward the declared length when the bucket provides it — the daemon's
  // cheap over-cap rejection reads it before streaming a byte.
  const contentLength = upstream.headers.get('content-length');
  if (contentLength !== null) {
    headers['Content-Length'] = contentLength;
  }
  return new Response(upstream.body, { status: 200, headers });
});
