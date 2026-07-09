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

/**
 * Org id for a folder row, or null when missing. Used by workflow actions
 * that accept a caller-supplied `folderId` and must verify it belongs to
 * the workflow's organization before writing documents into it.
 */
export const getFolderOrganizationId = internalQuery({
  args: { folderId: v.id('folders') },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    return folder?.organizationId ?? null;
  },
});
