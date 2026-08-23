'use node';

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import { blobRefValidator } from '../lib/storage/blob_ref';
import { listFolderContents as listFolderContentsImpl } from './list_folder_contents';
import { streamItemToStorage as streamItemToStorageImpl } from './stream_to_storage';

export const listFolderContents = internalAction({
  args: {
    itemId: v.string(),
    token: v.string(),
    recursive: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.boolean(),
    files: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          size: v.number(),
          mimeType: v.optional(v.string()),
          lastModified: v.optional(v.number()),
          relativePath: v.optional(v.string()),
        }),
      ),
    ),
    error: v.optional(v.string()),
  }),
  handler: async (_ctx, args) => {
    return await listFolderContentsImpl(args);
  },
});

export const streamItemToStorage = internalAction({
  args: {
    itemId: v.string(),
    token: v.string(),
    organizationId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    storageId: v.optional(blobRefValidator),
    mimeType: v.optional(v.string()),
    size: v.optional(v.number()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    return await streamItemToStorageImpl(ctx, args);
  },
});
