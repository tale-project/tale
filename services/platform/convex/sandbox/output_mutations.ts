// Internal mutations the sandbox Node action uses to commit storage uploads
// transactionally. Kept in the non-`use node` module because mutations don't
// run in the Node runtime.

import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';

const outputFileValidator = v.object({
  name: v.string(),
  storageId: v.id('_storage'),
  size: v.number(),
  contentType: v.string(),
});

/**
 * After the action has uploaded every output blob to `_storage`, this
 * mutation atomically inserts the `fileMetadata` rows that point at them.
 * All-or-nothing: if any insert fails the mutation aborts and the caller
 * deletes the orphaned `_storage` blobs.
 */
export const insertOutputFiles = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.optional(v.string()),
    uploadedBy: v.string(),
    files: v.array(outputFileValidator),
  },
  returns: v.array(
    v.object({
      name: v.string(),
      fileMetadataId: v.id('fileMetadata'),
      size: v.number(),
      contentType: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    const out: {
      name: string;
      fileMetadataId: Id<'fileMetadata'>;
      size: number;
      contentType: string;
    }[] = [];
    for (const f of args.files) {
      const fileMetadataId = await ctx.db.insert('fileMetadata', {
        organizationId: args.organizationId,
        storageId: f.storageId,
        ...(args.threadId !== undefined && { threadId: args.threadId }),
        uploadedBy: args.uploadedBy,
        fileName: f.name,
        contentType: f.contentType,
        size: f.size,
        source: 'agent',
        lifecycleStatus: 'active',
        statusChangedAt: now,
      });
      out.push({
        name: f.name,
        fileMetadataId,
        size: f.size,
        contentType: f.contentType,
      });
    }
    return out;
  },
});
