import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';

export const getThreadFileByPath = internalQuery({
  args: {
    threadId: v.string(),
    path: v.string(),
  },
  async handler(ctx, args) {
    const row = await ctx.db
      .query('threadFiles')
      .withIndex('by_thread_and_path', (q) =>
        q.eq('threadId', args.threadId).eq('path', args.path),
      )
      .first();
    return row;
  },
});

export const listThreadFiles = internalQuery({
  args: {
    threadId: v.string(),
    prefix: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const rows = await ctx.db
      .query('threadFiles')
      .withIndex('by_thread_and_updatedAt', (q) =>
        q.eq('threadId', args.threadId),
      )
      .order('desc')
      .collect();
    if (args.prefix === undefined || args.prefix.length === 0) return rows;
    return rows.filter((r) => r.path.startsWith(args.prefix!));
  },
});
