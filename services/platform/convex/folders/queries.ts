import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

import { query } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';

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

    const folders: Doc<'folders'>[] = [];

    const q = ctx.db
      .query('folders')
      .withIndex('by_organizationId_and_parentId', (qb) =>
        qb
          .eq('organizationId', args.organizationId)
          .eq('parentId', args.parentId),
      );

    for await (const folder of q) {
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

    return buildBreadcrumb(ctx, args.folderId);
  },
});

export async function buildBreadcrumb(
  ctx: QueryCtx,
  folderId: Id<'folders'>,
): Promise<Array<{ _id: Id<'folders'>; name: string }>> {
  const chain: Array<{ _id: Id<'folders'>; name: string }> = [];
  let currentId: Id<'folders'> | undefined = folderId;

  while (currentId) {
    const folder: Awaited<ReturnType<typeof ctx.db.get<'folders'>>> =
      await ctx.db.get(currentId);
    if (!folder) break;
    chain.push({ _id: folder._id, name: folder.name });
    currentId = folder.parentId;
  }

  chain.reverse();
  return chain;
}
