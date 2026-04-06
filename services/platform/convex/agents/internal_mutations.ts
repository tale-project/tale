import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { knowledgeFileRagStatusValidator } from './schema';

/**
 * Update RAG indexing status on a knowledge file in the binding record.
 * Called by the async RAG polling pipeline after file upload.
 */
export const updateKnowledgeFileRagInfo = internalMutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    fileId: v.id('_storage'),
    ragStatus: knowledgeFileRagStatusValidator,
    ragIndexedAt: v.optional(v.number()),
    ragError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const binding = await ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();

    if (!binding?.knowledgeFiles) return;

    const updated = binding.knowledgeFiles.map((f) => {
      if (f.fileId !== args.fileId) return f;
      return {
        ...f,
        ragStatus: args.ragStatus,
        ragIndexedAt: args.ragIndexedAt ?? f.ragIndexedAt,
        ragError: args.ragError,
      };
    });

    await ctx.db.patch(binding._id, { knowledgeFiles: updated });
  },
});

/**
 * Remove the entire binding record and clean up associated knowledge files.
 * Called after the JSON file has been deleted from filesystem.
 */
export const cleanupAgentBinding = internalMutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const binding = await ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();

    if (!binding) return;

    if (binding.knowledgeFiles) {
      for (const file of binding.knowledgeFiles) {
        await ctx.storage.delete(file.fileId);
      }
    }

    await ctx.db.delete(binding._id);
  },
});
