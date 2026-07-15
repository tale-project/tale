import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { mutation } from '../_generated/server';
import { toPublicUrl } from '../lib/helpers/public_storage_url';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import {
  blobRefValidator,
  convexStorageId,
  isS3Ref,
} from '../lib/storage/blob_ref';

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const url = await ctx.storage.generateUploadUrl();
    return toPublicUrl(url);
  },
});

// A blob orphaned this recently is a just-rejected upload; anything older is
// out of scope for this cleanup (bounds the window in which a caller could aim
// this at another feature's freshly-created, not-yet-linked blob).
const ORPHAN_CLEANUP_WINDOW_MS = 30 * 60 * 1000;

/**
 * Best-effort cleanup for a blob whose owning document creation was rejected.
 *
 * The desk uploader commits a blob (via the upload handoff + a direct POST/PUT)
 * BEFORE calling `createDocumentFromUpload`. When that mutation rejects (quota,
 * oversize, unsupported type, …) the blob is left orphaned — no `fileMetadata`
 * row, no document — and silently consumes storage. It can't be deleted inside
 * `createDocumentFromUpload` itself: a Convex mutation that throws rolls back
 * its `ctx.storage.delete` along with everything else. So the client calls this
 * compensating mutation from its failure path.
 *
 * Safety: deletes ONLY a blob that has no `fileMetadata` row — so a real, linked
 * file can never be removed. Convex blobs additionally require a recency bound
 * (a `_storage` system row's `_creationTime`) so this can't be aimed at another
 * feature's freshly-minted blob. For an `s3:` ref there is no system row; the
 * key was minted for this org's own bucket by the upload handoff and only the
 * minting client calls here, so the "no fileMetadata row" check plus an
 * org-membership gate is the safety boundary. The S3 delete needs the node
 * runtime, so it is scheduled (a mutation can't sign it).
 */
export const deleteRejectedUploadBlob = mutation({
  args: {
    storageId: blobRefValidator,
    /** Required to reclaim an `s3:` ref — addresses the org's bucket. */
    organizationId: v.optional(v.string()),
  },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    // Never touch a blob that became a real file (either backend).
    const linked = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (linked) return { deleted: false };

    if (isS3Ref(args.storageId)) {
      // Need the org to address the bucket; verify the caller belongs to it,
      // then schedule the org-scoped node delete (idempotent, best-effort).
      if (!args.organizationId) return { deleted: false };
      await getOrganizationMember(ctx, args.organizationId, authUser);
      await ctx.scheduler.runAfter(
        0,
        internal.files.blob_actions.deleteOrgBlobs,
        {
          organizationId: args.organizationId,
          refs: [String(args.storageId)],
        },
      );
      return { deleted: true };
    }

    const convexId = convexStorageId(args.storageId);
    if (convexId === null) return { deleted: false };
    const meta = await ctx.db.system.get(convexId);
    if (!meta) return { deleted: false };
    if (Date.now() - meta._creationTime > ORPHAN_CLEANUP_WINDOW_MS) {
      return { deleted: false };
    }

    try {
      await ctx.storage.delete(convexId);
      return { deleted: true };
    } catch (error) {
      // Already gone / racing another deleter — nothing to reclaim.
      console.warn(
        '[deleteRejectedUploadBlob] delete failed (may already be gone):',
        error instanceof Error ? error.message : error,
      );
      return { deleted: false };
    }
  },
});
