import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { query } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { isActiveOrg } from '../lib/rls/organization/assert_active_org';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { hasTeamAccess } from '../lib/team_access';
import { findFolderByPath } from './find_folder_by_path';

export const listFolders = query({
  args: {
    organizationId: v.string(),
    parentId: v.optional(v.id('folders')),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await getOrganizationMember(ctx, args.organizationId, authUser);

    const userTeamIds = await getUserTeamIds(ctx, authUser.userId);
    const folders: Doc<'folders'>[] = [];

    const q = ctx.db
      .query('folders')
      .withIndex('by_org_parent_name', (qb) =>
        qb
          .eq('organizationId', args.organizationId)
          .eq('parentId', args.parentId),
      );

    for await (const folder of q) {
      if (!hasTeamAccess(folder, userTeamIds)) continue;
      folders.push(folder);
    }

    return folders;
  },
});

export const getFolder = query({
  args: {
    folderId: v.id('folders'),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const folder = await ctx.db.get(args.folderId);
    // Active-org coherence: deny a folder carried over from another org.
    if (!folder || !isActiveOrg(folder.organizationId, args.organizationId)) {
      return null;
    }

    await getOrganizationMember(ctx, folder.organizationId, authUser);

    const userTeamIds = await getUserTeamIds(ctx, authUser.userId);
    if (!hasTeamAccess(folder, userTeamIds)) return null;

    return {
      _id: folder._id,
      name: folder.name,
      teamId: folder.teamId,
      parentId: folder.parentId,
      organizationId: folder.organizationId,
    };
  },
});

/**
 * Children of the folder at a human-readable documents path ("Clients/Acme"),
 * with each child's own path included. Built for app views: a pack config can
 * only hold scalars, so a view binds a configured folder PATH (not an opaque
 * id) and lists its subfolders (e.g. one per quarter) as actionable rows.
 * Same auth + team-visibility rules as `listFolders`. Returns null when the
 * path does not resolve (lets the view distinguish "wrong path" from "empty").
 */
export const listFolderChildrenByPath = query({
  args: {
    organizationId: v.string(),
    path: v.string(),
  },
  returns: v.union(
    v.null(),
    v.array(
      v.object({
        _id: v.id('folders'),
        name: v.string(),
        path: v.string(),
      }),
    ),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const segments = args.path.split('/').filter((s) => s.trim().length > 0);
    if (segments.length === 0) return null;
    const parentId = await findFolderByPath(ctx, args.organizationId, segments);
    if (!parentId) return null;

    const parent = await ctx.db.get(parentId);
    if (!parent) return null;
    const userTeamIds = await getUserTeamIds(ctx, authUser.userId);
    if (!hasTeamAccess(parent, userTeamIds)) return null;

    const basePath = segments.join('/');
    const children: { _id: Id<'folders'>; name: string; path: string }[] = [];
    const q = ctx.db
      .query('folders')
      .withIndex('by_org_parent_name', (qb) =>
        qb.eq('organizationId', args.organizationId).eq('parentId', parentId),
      );
    for await (const folder of q) {
      if (!hasTeamAccess(folder, userTeamIds)) continue;
      children.push({
        _id: folder._id,
        name: folder.name,
        path: `${basePath}/${folder.name}`,
      });
    }
    return children;
  },
});

export const getFolderBreadcrumb = query({
  args: {
    folderId: v.id('folders'),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const folder = await ctx.db.get(args.folderId);
    // Active-org coherence: deny a folder carried over from another org.
    if (!folder || !isActiveOrg(folder.organizationId, args.organizationId)) {
      return [];
    }

    await getOrganizationMember(ctx, folder.organizationId, authUser);

    const userTeamIds = await getUserTeamIds(ctx, authUser.userId);

    if (folder.teamId && !hasTeamAccess(folder, userTeamIds)) {
      return [];
    }

    const breadcrumb = await buildBreadcrumb(ctx, args.folderId);

    const accessibleBreadcrumb: Array<{ _id: Id<'folders'>; name: string }> =
      [];
    for (const item of breadcrumb) {
      if (!hasTeamAccess(item, userTeamIds)) break;
      accessibleBreadcrumb.push({ _id: item._id, name: item.name });
    }

    return accessibleBreadcrumb;
  },
});

const MAX_BREADCRUMB_DEPTH = 20;

interface BreadcrumbItem {
  _id: Id<'folders'>;
  name: string;
  teamId?: string | null;
  teamTags?: string[];
}

export async function buildBreadcrumb(
  ctx: QueryCtx,
  folderId: Id<'folders'>,
): Promise<BreadcrumbItem[]> {
  const chain: BreadcrumbItem[] = [];
  const visited = new Set<string>();
  let currentId: Id<'folders'> | undefined = folderId;

  while (currentId && chain.length < MAX_BREADCRUMB_DEPTH) {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    const folder: Doc<'folders'> | null = await ctx.db.get(currentId);
    if (!folder) break;
    chain.push({
      _id: folder._id,
      name: folder.name,
      teamId: folder.teamId,
      teamTags: folder.teamTags,
    });
    currentId = folder.parentId;
  }

  chain.reverse();
  return chain;
}

/**
 * Build a slash-separated folder path string from a folder ID.
 * Returns undefined if the folder cannot be resolved.
 */
export async function buildFolderPath(
  ctx: QueryCtx,
  folderId: Id<'folders'>,
): Promise<string | undefined> {
  const breadcrumb = await buildBreadcrumb(ctx, folderId);
  if (breadcrumb.length === 0) return undefined;
  return breadcrumb.map((b) => b.name).join('/');
}
