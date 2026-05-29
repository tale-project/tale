import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { findFolderByPath as findFolderByPathHelper } from './find_folder_by_path';

export const findFolderByPath = internalQuery({
  args: {
    organizationId: v.string(),
    pathSegments: v.array(v.string()),
  },
  returns: v.union(v.id('folders'), v.null()),
  handler: async (ctx, args) => {
    return await findFolderByPathHelper(
      ctx,
      args.organizationId,
      args.pathSegments,
    );
  },
});
