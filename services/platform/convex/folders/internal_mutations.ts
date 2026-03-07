import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { getOrCreateFolderPath as getOrCreateFolderPathHelper } from './get_or_create_path';

export const getOrCreateFolderPath = internalMutation({
  args: {
    organizationId: v.string(),
    pathSegments: v.array(v.string()),
    createdBy: v.optional(v.string()),
    teamId: v.optional(v.string()),
  },
  returns: v.union(v.id('folders'), v.null()),
  handler: async (ctx, args) => {
    return (
      (await getOrCreateFolderPathHelper(
        ctx,
        args.organizationId,
        args.pathSegments,
        args.createdBy,
        args.teamId,
      )) ?? null
    );
  },
});
