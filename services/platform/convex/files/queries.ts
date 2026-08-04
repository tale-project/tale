import { v } from 'convex/values';

import { prepareFileUrlIds } from '../../lib/shared/file-url-batch';
import type { QueryCtx } from '../_generated/server';
import { query } from '../_generated/server';
import {
  buildBlobServeUrl,
  buildDownloadUrl,
  toPublicUrl,
} from '../lib/helpers/public_storage_url';
import { getAuthUserIdentity } from '../lib/rls';
import {
  blobRefValidator,
  convexStorageId,
  isS3Ref,
  type BlobRef,
} from '../lib/storage/blob_ref';

/**
 * Resolve a download URL for a blob reference. A Convex `_storage` id gets a
 * direct (proxy-rewritten) storage URL; an `s3:` ref gets the node `/storage`
 * route URL that presigns + 302-redirects (a query can't presign). For an S3
 * ref we resolve the owning org from the blob's `fileMetadata` row so the route
 * can address the right bucket; a ref with no fileMetadata row is unservable
 * here → null.
 *
 * `fileName` opts into a named download: the URL then routes through the
 * `/storage` HTTP action, which serves the blob with `Content-Disposition:
 * attachment; filename=…`. Without it a Convex blob serves from the bare
 * `/api/storage/<uuid>` path and the browser saves it under the uuid. Leave
 * it off for URLs that must render inline (image previews, the document
 * preview dialog).
 */
async function resolveBlobUrl(
  ctx: QueryCtx,
  ref: BlobRef,
  fileName?: string,
): Promise<string | null> {
  if (isS3Ref(ref)) {
    const meta = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', ref))
      .first();
    if (!meta) return null;
    return buildBlobServeUrl(
      String(ref),
      meta.organizationId,
      fileName ?? meta.fileName,
    );
  }
  const convexId = convexStorageId(ref);
  if (convexId === null) return null;
  // Resolve the storage URL even on the named path — a null here means the
  // blob was deleted, and callers rely on null to drop dead references.
  const url = await ctx.storage.getUrl(convexId);
  if (!url) return null;
  return fileName === undefined
    ? toPublicUrl(url)
    : buildDownloadUrl(String(convexId), fileName);
}

export const getFileUrl = query({
  args: {
    fileId: blobRefValidator,
    fileName: v.optional(v.string()),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    try {
      return await resolveBlobUrl(ctx, args.fileId, args.fileName);
    } catch {
      return null;
    }
  },
});

export const getFileUrls = query({
  args: {
    fileIds: v.array(blobRefValidator),
  },
  returns: v.array(
    v.object({
      fileId: blobRefValidator,
      url: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

    // Dedupe then resolve all — mirrors documents `batchGetStorageUrls`. Never
    // silently truncate: a low product cap used to drop Outcome / thumbnail
    // URLs while titles still rendered.
    const uniqueIds = prepareFileUrlIds(args.fileIds);

    return Promise.all(
      uniqueIds.map(async (fileId) => {
        try {
          return { fileId, url: await resolveBlobUrl(ctx, fileId) };
        } catch {
          return { fileId, url: null };
        }
      }),
    );
  },
});
