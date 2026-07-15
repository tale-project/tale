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

import { action, internalAction } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import { toPublicUrl } from '../lib/helpers/public_storage_url';
import {
  deleteBlob,
  generateBlobUpload as generateBlobUploadHandoff,
  getBlobUrl,
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
