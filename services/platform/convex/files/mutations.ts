import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import { toPublicUrl } from '../lib/helpers/public_storage_url';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

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
 * The desk uploader commits a `_storage` blob (via `generateUploadUrl` + a
 * direct POST) BEFORE calling `createDocumentFromUpload`. When that mutation
 * rejects (quota, oversize, unsupported type, …) the blob is left orphaned —
 * no `fileMetadata` row, no document — and silently consumes storage. It can't
 * be deleted inside `createDocumentFromUpload` itself: a Convex mutation that
 * throws rolls back its `ctx.storage.delete` along with everything else. So the
 * client calls this compensating mutation from its failure path.
 *
 * Safety: deletes ONLY a blob that (a) has no `fileMetadata` row — so a real,
 * linked file can never be removed — and (b) was created within the cleanup
 * window. A blob owned by another feature (automation icon, skill asset, …)
 * has no `fileMetadata` row either, hence the recency bound; realistically the
 * caller only ever passes a storageId it just minted here.
 */
export const deleteRejectedUploadBlob = mutation({
  args: { storageId: v.id('_storage') },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    // Never touch a blob that became a real file.
    const linked = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (linked) return { deleted: false };

    const meta = await ctx.db.system.get(args.storageId);
    if (!meta) return { deleted: false };
    if (Date.now() - meta._creationTime > ORPHAN_CLEANUP_WINDOW_MS) {
      return { deleted: false };
    }

    try {
      await ctx.storage.delete(args.storageId);
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
