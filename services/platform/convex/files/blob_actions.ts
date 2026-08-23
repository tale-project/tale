'use node';

/**
 * Backend-aware blob ACTIONS for the browser upload handoff + the S3 delete
 * lane. These live in a `'use node'` module because presigning / signing S3
 * requests needs the node runtime — a V8 query/mutation cannot. Convex-backed
 * orgs work here too (the action just mints a `generateUploadUrl`), so the
 * client calls ONE endpoint regardless of the org's storage backend.
 *
 * See `convex/lib/storage/blob_access.ts` for the backend routing and the
 * stored-reference encoding (`_storage` id | `s3:<key>`).
 */

import { v } from 'convex/values';

import { DOCUMENT_MAX_FILE_SIZE } from '../../lib/shared/file-types';
import { internal } from '../_generated/api';
import { action, internalAction } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import { toPublicUrl } from '../lib/helpers/public_storage_url';
import {
  deleteBlob,
  generateBlobUpload as generateBlobUploadHandoff,
  getBlobUrl,
  isS3Ref,
  putBlob,
  readBlobBytes,
  s3BlobSize,
} from '../lib/storage/blob_access';

export interface BlobUploadHandoff {
  /** Where the browser sends the bytes. */
  url: string;
  /** `POST` → Convex `_storage` (bind the returned id); `PUT` → the org's S3
   *  bucket (bind `s3Ref`). */
  method: 'POST' | 'PUT';
  /** Present iff `method === 'PUT'`: the reference the client binds after the
   *  upload succeeds (the object key is known up front for S3). */
  s3Ref?: string;
}

/**
 * Mint an upload handoff for the caller's org. Routes to the org's own S3 bucket
 * when configured, else Convex `_storage`. The caller MUST be a member of
 * `organizationId` — the blob is namespaced under that org and, for an S3-backed
 * org, is signed against that org's bucket, so cross-org targeting is refused
 * here (not just isolated by key).
 */
export const generateBlobUpload = action({
  args: {
    organizationId: v.string(),
    contentType: v.optional(v.string()),
  },
  returns: v.object({
    url: v.string(),
    method: v.union(v.literal('POST'), v.literal('PUT')),
    s3Ref: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<BlobUploadHandoff> => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const handoff = await generateBlobUploadHandoff(ctx, auth.orgSlug, {
      contentType: args.contentType,
    });
    // Convex `generateUploadUrl` returns an INTERNAL origin unreachable from the
    // browser; rewrite it through the public proxy (parity with
    // `files.mutations.generateUploadUrl`). The S3 presigned PUT already
    // addresses the org's public endpoint, so leave it untouched.
    const url =
      handoff.method === 'POST' ? toPublicUrl(handoff.url) : handoff.url;
    return { url, method: handoff.method, s3Ref: handoff.s3Ref };
  },
});

/**
 * Backend-aware upload handoff for the WebDAV PUT path. Unlike the public
 * `generateBlobUpload`, this bypasses Better Auth — the WebDAV Hono layer has
 * already done its Basic-auth check and passes the authenticated principal's
 * `organizationId`. Internal (admin-key ConvexHttpClient only). Returns the raw
 * Convex POST url (the WebDAV layer re-homes it onto the reachable backend
 * origin itself) or a presigned S3 PUT. An unresolvable org falls back to
 * Convex `_storage` — the backfill relocates it later.
 */
export const generateWebdavBlobUpload = internalAction({
  args: {
    organizationId: v.string(),
    contentType: v.optional(v.string()),
  },
  returns: v.object({
    url: v.string(),
    method: v.union(v.literal('POST'), v.literal('PUT')),
    s3Ref: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<BlobUploadHandoff> => {
    const orgSlug = await orgSlugFromIdOrNull(ctx, args.organizationId);
    if (orgSlug === null) {
      console.warn(
        `[generateWebdavBlobUpload] org ${args.organizationId} unresolvable; using Convex _storage`,
      );
      return { url: await ctx.storage.generateUploadUrl(), method: 'POST' };
    }
    return await generateBlobUploadHandoff(ctx, orgSlug, {
      contentType: args.contentType,
    });
  },
});

/**
 * Backend-aware upload handoff for the projects REST door
 * (`POST /api/v1/projects/{id}/uploads`). Mirrors `generateWebdavBlobUpload`
 * — internal, org resolved by id, Convex `_storage` fallback when the org is
 * unresolvable — but rewrites the Convex POST lane through the public proxy
 * like the public `generateBlobUpload` does: the caller is an external worker
 * on the public origin, with no re-homing layer of its own. The S3 presigned
 * PUT already addresses the org's public endpoint, so it stays untouched.
 */
export const generateRestBlobUpload = internalAction({
  args: {
    organizationId: v.string(),
    contentType: v.optional(v.string()),
  },
  returns: v.object({
    url: v.string(),
    method: v.union(v.literal('POST'), v.literal('PUT')),
    s3Ref: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<BlobUploadHandoff> => {
    const orgSlug = await orgSlugFromIdOrNull(ctx, args.organizationId);
    if (orgSlug === null) {
      console.warn(
        `[generateRestBlobUpload] org ${args.organizationId} unresolvable; using Convex _storage`,
      );
      return {
        url: toPublicUrl(await ctx.storage.generateUploadUrl()),
        method: 'POST',
      };
    }
    const handoff = await generateBlobUploadHandoff(ctx, orgSlug, {
      contentType: args.contentType,
    });
    const url =
      handoff.method === 'POST' ? toPublicUrl(handoff.url) : handoff.url;
    return { url, method: handoff.method, s3Ref: handoff.s3Ref };
  },
});

/**
 * Presign a short-lived GET URL for an `s3:` blob so the V8 `/storage` httpAction
 * (which cannot sign S3 requests) can 302-redirect the browser to it. Resolves
 * the org's bucket from `organizationId`; returns `null` when the org is
 * unresolvable (surfaced as a 404 by the route). Convex refs never reach here —
 * the route streams those directly.
 */
export const presignBlobGet = internalAction({
  args: {
    organizationId: v.string(),
    ref: v.string(),
    filename: v.optional(v.string()),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    const orgSlug = await orgSlugFromIdOrNull(ctx, args.organizationId);
    if (orgSlug === null) {
      console.warn(
        `[presignBlobGet] org ${args.organizationId} unresolvable; cannot presign ${args.ref}`,
      );
      return null;
    }
    return await getBlobUrl(ctx, orgSlug, args.ref, {
      filename: args.filename ?? undefined,
    });
  },
});

/**
 * Store bytes for an org through the backend-aware seam and return the blob
 * reference. Internal — the lane V8 callers (agent file tools bundled into the
 * V8 workflow engine) use to write org-owned blobs: they cannot import the
 * `'use node'` seam themselves, so they hop through this action. Bounded by
 * Convex's function-argument ceiling — callers own keeping their payloads
 * small (the lane V8 file tools emit ≤ 10 MB per write). Falls back to
 * Convex `_storage` when the org is unresolvable (never fails a write over
 * blob routing).
 */
export const storeOrgBlob = internalAction({
  args: {
    organizationId: v.string(),
    bytes: v.bytes(),
    contentType: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const orgSlug = await orgSlugFromIdOrNull(ctx, args.organizationId);
    const bytes = new Uint8Array(args.bytes);
    if (orgSlug === null) {
      console.warn(
        `[storeOrgBlob] org ${args.organizationId} unresolvable; storing in Convex _storage`,
      );
      return await ctx.storage.store(
        new Blob([args.bytes], { type: args.contentType }),
      );
    }
    return String(await putBlob(ctx, orgSlug, bytes, args.contentType));
  },
});

/**
 * Read a blob's raw bytes from whichever backend owns it. Internal — the lane
 * V8 callers (httpActions, V8 actions) use for an `s3:` ref they cannot read
 * themselves. Deliberately returns BYTES, not a URL: the `/api/tts-audio`
 * route streams audio through its own cookie-authenticated response and must
 * never hand out a bearer-replayable presigned URL. Bounded by Convex's
 * function-result ceiling — callers own keeping their blobs small (TTS chunks
 * are ≤ 5 MB by `MAX_AUDIO_BYTES`). Returns `null` (logged) when the org is
 * unresolvable or the object is missing, so the route can 404 cleanly.
 */
export const readOrgBlob = internalAction({
  args: {
    organizationId: v.string(),
    ref: v.string(),
  },
  returns: v.union(v.bytes(), v.null()),
  handler: async (ctx, args): Promise<ArrayBuffer | null> => {
    const orgSlug = await orgSlugFromIdOrNull(ctx, args.organizationId);
    if (orgSlug === null) {
      console.warn(
        `[readOrgBlob] org ${args.organizationId} unresolvable; cannot read ${args.ref}`,
      );
      return null;
    }
    try {
      const bytes = await readBlobBytes(ctx, orgSlug, args.ref);
      // Copy into an exact-size ArrayBuffer — `bytes.buffer` may be larger
      // than the view (offset/length), and `v.bytes()` carries ArrayBuffers.
      const out = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(out).set(bytes);
      return out;
    } catch (err) {
      console.warn('[readOrgBlob] blob read failed', {
        ref: args.ref,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },
});

/**
 * Physically delete a batch of blob references from whichever backend owns them.
 * Internal — scheduled from `eraseDocumentBlobs` for the `s3:` refs it cannot
 * delete inline (a mutation can't sign an S3 request). Convex refs are deleted
 * inline by the mutation itself; this action is the S3 lane. Best-effort +
 * idempotent: a missing object / unresolvable org is logged, never thrown, so
 * one bad ref can't wedge a cleanup batch.
 */
export const deleteOrgBlobs = internalAction({
  args: {
    organizationId: v.string(),
    refs: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (args.refs.length === 0) return null;
    const orgSlug = await orgSlugFromIdOrNull(ctx, args.organizationId);
    if (orgSlug === null) {
      console.warn(
        `[deleteOrgBlobs] org ${args.organizationId} unresolvable; skipping delete of ${args.refs.length} blob ref(s)`,
      );
      return null;
    }
    for (const ref of args.refs) {
      try {
        await deleteBlob(ctx, orgSlug, ref);
      } catch (err) {
        console.warn('[deleteOrgBlobs] blob delete failed', {
          ref,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return null;
  },
});

/**
 * Verify an `s3:` upload's REAL size against the product cap and correct the
 * row the binder created from the client-declared size. A presigned PUT
 * enforces no Content-Length, so a member could declare 1 KB and PUT gigabytes,
 * bypassing `DOCUMENT_MAX_FILE_SIZE` + the volume quota. Scheduled (best-effort)
 * from the binders right after an `s3:` ref is bound. HEAD the object → write
 * the authoritative size (so `computeUserUploadVolumeBytes` is honest); if it
 * is over the cap, mark the row failed AND delete the oversize object from the
 * org's bucket. No-op for Convex refs (their size is authoritative at bind) and
 * for a missing object (never-uploaded / already-reclaimed).
 */
export const verifyS3BlobSize = internalAction({
  args: {
    storageId: v.string(),
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (!isS3Ref(args.storageId)) return null;
    const orgSlug = await orgSlugFromIdOrNull(ctx, args.organizationId);
    if (orgSlug === null) {
      console.warn(
        `[verifyS3BlobSize] org ${args.organizationId} unresolvable; cannot verify ${args.storageId}`,
      );
      return null;
    }
    let size: number | null;
    try {
      size = await s3BlobSize(orgSlug, args.storageId);
    } catch (err) {
      // A HEAD failure must not wedge the upload — log and leave the
      // client-declared size in place (the upload policy already gated on it).
      console.warn('[verifyS3BlobSize] HEAD failed', {
        ref: args.storageId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    if (size === null) return null;

    const overCap = size > DOCUMENT_MAX_FILE_SIZE;
    await ctx.runMutation(
      internal.file_metadata.internal_mutations.applyVerifiedBlobSize,
      {
        storageId: args.storageId,
        size,
        overCap,
        limitBytes: DOCUMENT_MAX_FILE_SIZE,
      },
    );
    if (overCap) {
      await deleteBlob(ctx, orgSlug, args.storageId);
      console.warn(
        `[verifyS3BlobSize] rejected oversize s3 upload ${args.storageId}: ${size} > ${DOCUMENT_MAX_FILE_SIZE} bytes; row failed, object deleted`,
      );
    }
    return null;
  },
});
