import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import { resolveProjectAccessForUser } from '../projects/resolve_project_access';
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
 * Resolve a project's TOP-LEVEL folder by name (read-only), gated on the
 * caller's project read access. Mirrors `getOrCreateProjectRootFolder`'s
 * lookup (`by_org_project_parent_name`, parentId undefined) without the
 * create/edit path — used by read actions that pre-fill a form from a
 * project config file (e.g. `Setup/validation-policy.yaml`). Null when the caller
 * cannot read the project or the folder does not exist yet.
 */
export const findProjectRootFolder = internalQuery({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    name: v.string(),
    userId: v.string(),
  },
  returns: v.union(v.id('folders'), v.null()),
  handler: async (ctx, args) => {
    const access = await resolveProjectAccessForUser(ctx, args.projectId, {
      userId: args.userId,
      organizationId: args.organizationId,
    });
    if (!access.canRead) return null;
    const folder = await ctx.db
      .query('folders')
      .withIndex('by_org_project_parent_name', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('projectId', args.projectId)
          .eq('parentId', undefined)
          .eq('name', args.name.trim()),
      )
      .first();
    return folder?._id ?? null;
  },
});

/**
 * A project's TOP-LEVEL folders for an explicit user — the backing query of
 * `GET /api/v1/projects/{id}/folders`. The generic subset of the session
 * `listProjectRootFolders` (projects/queries.ts), reusing its query
 * mechanics: collect the project's folders by index prefix, then keep roots
 * in memory — pinning `parentId: undefined` on the index can miss rows whose
 * parentId was omitted at insert. Returns `null` when the project does not
 * resolve for this user (absent, cross-org, garbage id, or invisible), so the
 * REST surface answers all four with the same opaque 404.
 */
export const listProjectRootFoldersForUser = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    projectId: v.string(),
  },
  returns: v.union(
    v.array(v.object({ id: v.id('folders'), name: v.string() })),
    v.null(),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ id: Id<'folders'>; name: string }> | null> => {
    const projectId = ctx.db.normalizeId('projects', args.projectId);
    if (projectId === null) return null;
    const access = await resolveProjectAccessForUser(ctx, projectId, {
      userId: args.userId,
      organizationId: args.organizationId,
    });
    if (!access.canRead) return null;

    const folders = await ctx.db
      .query('folders')
      .withIndex('by_org_project_parent_name', (q) =>
        q.eq('organizationId', args.organizationId).eq('projectId', projectId),
      )
      .collect();

    return folders
      .filter((folder) => folder.parentId === undefined)
      .map((folder) => ({ id: folder._id, name: folder.name }));
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
