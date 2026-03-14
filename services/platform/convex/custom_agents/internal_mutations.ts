import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { knowledgeFileRagStatusValidator } from './schema';

export const updateKnowledgeFileRagInfo = internalMutation({
  args: {
    customAgentId: v.id('customAgents'),
    fileId: v.id('_storage'),
    ragStatus: knowledgeFileRagStatusValidator,
    ragIndexedAt: v.optional(v.number()),
    ragError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rootId = args.customAgentId;

    const draft = await ctx.db
      .query('customAgents')
      .withIndex('by_root_status', (q) =>
        q.eq('rootVersionId', rootId).eq('status', 'draft'),
      )
      .first();

    const agent = draft ?? (await ctx.db.get(rootId));
    if (!agent?.knowledgeFiles) return;

    const updated = agent.knowledgeFiles.map((f) => {
      if (f.fileId !== args.fileId) return f;
      return {
        ...f,
        ragStatus: args.ragStatus,
        ragIndexedAt: args.ragIndexedAt ?? f.ragIndexedAt,
        ragError: args.ragError,
      };
    });

    await ctx.db.patch(agent._id, {
      knowledgeFiles: updated,
    });
  },
});

export const removeDeletedWorkflowBindings = internalMutation({
  args: {
    organizationId: v.string(),
    workflowRootId: v.id('wfDefinitions'),
  },
  handler: async (ctx, { organizationId, workflowRootId }) => {
    for await (const agent of ctx.db
      .query('customAgents')
      .withIndex('by_organization', (q) =>
        q.eq('organizationId', organizationId),
      )) {
      if (!agent.workflowBindings?.includes(workflowRootId)) continue;

      const filtered = agent.workflowBindings.filter(
        (id) => id !== workflowRootId,
      );

      await ctx.db.patch(agent._id, {
        workflowBindings: filtered.length ? filtered : undefined,
      });
    }
  },
});
