import { mutation, query, internalAction } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { serializeVariables as doSerialize } from './workflow/helpers/serialization/serialize_variables';

/**
 * Generate upload URL for file attachments
 */
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Get file URL for display
 */
export const getFileUrl = query({
  args: {
    fileId: v.id('_storage'),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.fileId);
  },
});

/**
 * Serialize variables in an action context and return serialized JSON and optional storageId.
 * Use this wrapper from mutations via ctx.runAction(internal.file.serializeVariables, ...).
 */
export const serializeVariables = internalAction({
  args: {
    variables: v.optional(v.any()),
    oldStorageId: v.optional(v.id('_storage')),
  },
  returns: v.object({
    serialized: v.string(),
    storageId: v.optional(v.id('_storage')),
  }),
  handler: async (
    ctx,
    args: {
      variables?: Record<string, unknown> | null;
      oldStorageId?: Id<'_storage'>;
    },
  ) => {
    const { serialized, storageId } = await doSerialize(
      ctx,
      args.variables ?? {},
      args.oldStorageId,
    );
    return { serialized, storageId };
  },
});
