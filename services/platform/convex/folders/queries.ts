import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { query } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { isActiveOrg } from '../lib/rls/organization/assert_active_org';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { hasTeamAccess } from '../lib/team_access';

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
