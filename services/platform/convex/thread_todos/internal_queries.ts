import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { todoItemValidator } from './schema';

export const getByThread = internalQuery({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
  },
  returns: v.union(
    v.object({
      todos: v.array(todoItemValidator),
      activeTodoId: v.optional(v.string()),
      integrationCallCount: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('threadTodos')
      .withIndex('by_org_thread', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('threadId', args.threadId),
      )
      .first();
    if (!record) return null;
    return {
      todos: record.todos,
      activeTodoId: record.activeTodoId,
      integrationCallCount: record.integrationCallCount,
    };
  },
});
