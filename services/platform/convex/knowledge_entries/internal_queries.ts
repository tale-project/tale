import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';

export const getEntryById = internalQuery({
  args: {
    entryId: v.id('knowledgeEntries'),
  },
  handler: async (ctx, args): Promise<Doc<'knowledgeEntries'> | null> => {
    return await ctx.db.get(args.entryId);
  },
});
