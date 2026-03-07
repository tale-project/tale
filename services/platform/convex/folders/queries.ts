import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

import { query } from '../_generated/server';
import { authComponent } from '../auth';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls';
import { hasTeamAccess } from '../lib/team_access';

export const listFolders = query({
  args: {
    organizationId: v.string(),
    parentId: v.optional(v.id('folders')),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
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

export const getFolderBreadcrumb = query({
  args: {
    folderId: v.id('folders'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      return [];
    }

    await getOrganizationMember(ctx, folder.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));

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
    chain.push({ _id: folder._id, name: folder.name, teamId: folder.teamId });
    currentId = folder.parentId;
  }

  chain.reverse();
  return chain;
}
