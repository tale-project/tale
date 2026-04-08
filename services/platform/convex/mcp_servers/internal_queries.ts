import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';

export const getById = internalQuery({
  args: {
    id: v.id('mcpServers'),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});
