import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';

export const getById = internalQuery({
  args: { artifactId: v.id('artifacts') },
  handler: async (ctx, { artifactId }) => {
    return await ctx.db.get(artifactId);
  },
});

export const listByThread = internalQuery({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, { organizationId, threadId }) => {
    const rows = [];
    for await (const row of ctx.db
      .query('artifacts')
      .withIndex('by_organizationId_and_thread', (q) =>
        q.eq('organizationId', organizationId).eq('threadId', threadId),
      )
      .order('asc')) {
      rows.push(row);
    }
    return rows;
  },
});
