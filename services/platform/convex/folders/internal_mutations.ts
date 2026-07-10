import { ConvexError, v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { resolveProjectAccessForUser } from '../projects/resolve_project_access';
import { getOrCreateFolderPath as getOrCreateFolderPathHelper } from './get_or_create_path';
import { validateFolderName } from './mutations';

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

/**
 * Find or create a top-level project folder by name. Used by automation Forms
 * that seed a setup folder + text file in one public action — hub
 * `getOrCreateFolderPath` must not be used (it refuses project scope).
 */
export const getOrCreateProjectRootFolder = internalMutation({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    name: v.string(),
    userId: v.string(),
  },
  returns: v.object({
    folderId: v.id('folders'),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const trimmedName = validateFolderName(args.name);

    const access = await resolveProjectAccessForUser(ctx, args.projectId, {
      userId: args.userId,
      organizationId: args.organizationId,
    });
    if (!access.canRead) {
      throw new ConvexError({
        code: 'PROJECT_FORBIDDEN',
        message: 'You do not have access to this project',
      });
    }
    if (!access.canEdit) {
      throw new ConvexError({
        code: 'RBAC_FORBIDDEN',
        message: 'You do not have permission to add folders to this project',
      });
    }

    const existing = await ctx.db
      .query('folders')
      .withIndex('by_org_project_parent_name', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('projectId', args.projectId)
          .eq('parentId', undefined)
          .eq('name', trimmedName),
      )
      .first();

    if (existing) {
      return { folderId: existing._id, created: false };
    }

    const folderId = await ctx.db.insert('folders', {
      organizationId: args.organizationId,
      name: trimmedName,
      projectId: args.projectId,
      createdBy: args.userId,
    });
    return { folderId, created: true };
  },
});
