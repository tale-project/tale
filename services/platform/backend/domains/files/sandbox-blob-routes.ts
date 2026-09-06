import { Hono } from 'hono';
import type { Sql } from 'postgres';

import {
  isS3Ref,
  parseBlobRef,
  s3KeyBelongsToOrg,
} from '../../core/lib/storage/blob_ref.ts';
import { verifyStageToken } from '../../core/lib/storage/sandbox_stage_token.ts';
import {
  locateOrgObjectStore,
  s3PresignGetUrl,
} from '../../lib/object-store.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';

/**
 * `/api/sandbox-blob` — stream an org-bucket (`s3:`) blob to a sandbox
 * session container: the 0.4 httpAction on the 0.5 backend origin
 * (`SANDBOX_HTTP_API_BASE_URL`, the same door the connectors bridge rides).
 *
 * Session containers sit on the SSRF-locked sandbox net: they reach this
 * backend through the `backend-api` alias but have no route to an org's
 * S3/R2 endpoint, and a presigned bucket URL is a bearer credential that
 * must never enter an untrusted container. The staging path therefore hands
 * the in-container daemon THIS route: it verifies a short-lived HMAC stage
 * token (lib/storage/sandbox_stage_token.ts), presigns server-side after
 * re-checking the key sits in the token org's namespace, and passes the
 * upstream body through as a stream (no buffering — a workspace file can be
 * 100 MB).
 *
 * No IP rate limit on purpose: the token gate is strictly stronger
 * (unforgeable, single-blob, minutes-lived), and an IP bucket would
 * throttle a legitimate 100-file staging burst from one sandbox address.
 */
export function createSandboxBlobRoutes(deps: { sql: Sql }): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const token = c.req.query('token');
    if (token === undefined || token === '') {
      return c.text('Missing token', 400);
    }
    const verdict = await verifyStageToken(token);
    if (!verdict.ok) {
      if (verdict.reason === 'unconfigured') {
        // The deployment carries no HMAC root — it also could not have
        // SIGNED a token, so a request landing here is a config gap, not an
        // attack.
        console.warn(
          '[sandbox-blob] refused: no WEBDAV_APP_PASSWORD_HMAC_KEY to verify with',
        );
        return c.text('Stage tokens unavailable', 503);
      }
      // malformed / bad_signature / expired collapse to one status — a
      // forger learns nothing about which check tripped.
      return c.text('Forbidden', 403);
    }

    const { ref, org } = verdict.payload;
    // `_storage` blobs stage via their own capability URLs; this route
    // exists solely for the bucket lane.
    if (!isS3Ref(ref)) {
      return c.text('Unsupported ref', 400);
    }
    const parsed = parseBlobRef(ref);
    if (parsed.backend !== 's3') {
      return c.text('Unsupported ref', 400);
    }

    // Fail closed as 404: an unresolvable org, a key outside the org's
    // namespace, and an org with no object storage configured must all be
    // indistinguishable from a missing object.
    const orgSlug = await resolveOrgSlug(deps.sql, org);
    if (orgSlug === null || !s3KeyBelongsToOrg(parsed.key, orgSlug)) {
      return c.text('File not found', 404);
    }
    let presigned: string;
    try {
      // The blob may predate the org's own bucket (see `locateOrgObjectStore`).
      const store = await locateOrgObjectStore(orgSlug, parsed.key);
      presigned = await s3PresignGetUrl(store, parsed.key);
    } catch (error) {
      console.warn(
        `[sandbox-blob] presign refused for org ${org}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return c.text('File not found', 404);
    }

    let upstream: Response;
    try {
      upstream = await fetch(presigned);
    } catch (error) {
      console.warn(
        `[sandbox-blob] upstream fetch failed for org ${org}:`,
        error instanceof Error ? error.message : String(error),
      );
      return c.text('Upstream fetch failed', 502);
    }
    if (!upstream.ok || upstream.body === null) {
      console.warn(
        `[sandbox-blob] upstream returned ${upstream.status} for org ${org}`,
      );
      return c.text('Upstream fetch failed', 502);
    }

    const headers: Record<string, string> = {
      'Content-Type':
        upstream.headers.get('content-type') ?? 'application/octet-stream',
      // These bytes are user-uploaded and this route lives on the app
      // origin: force download semantics so a leaked stage-token URL pasted
      // into a browser can never render as a same-origin document (the
      // in-sandbox consumer is curl/fetch, which ignores disposition).
      'Content-Disposition': 'attachment',
      'X-Content-Type-Options': 'nosniff',
    };
    // Forward the declared length when the bucket provides it — the
    // daemon's cheap over-cap rejection reads it before streaming a byte.
    const contentLength = upstream.headers.get('content-length');
    if (contentLength !== null) {
      headers['Content-Length'] = contentLength;
    }
    return new Response(upstream.body, { status: 200, headers });
  });

  return app;
}
