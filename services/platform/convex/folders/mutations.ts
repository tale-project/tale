import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';

const MAX_FOLDER_NAME_LENGTH = 255;
const RESERVED_NAMES = new Set(['.', '..']);

export function validateFolderName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error('Folder name cannot be empty');
  }
  if (trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    throw new Error('Folder name is too long');
  }
  if (RESERVED_NAMES.has(trimmed)) {
    throw new Error('Invalid folder name');
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('Folder name cannot contain path separators');
  }
  return trimmed;
}

async function checkDuplicateName(
  ctx: MutationCtx,
  organizationId: string,
  parentId: Id<'folders'> | undefined,
  name: string,
  excludeId?: Id<'folders'>,
) {
  const existing = await ctx.db
    .query('folders')
    .withIndex('by_org_parent_name', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('parentId', parentId)
        .eq('name', name),
    )
    .first();

  if (existing && existing._id !== excludeId) {
    throw new Error('A folder with this name already exists');
  }
}

export const createFolder = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    parentId: v.optional(v.id('folders')),
    teamId: v.optional(v.string()),
  },
  returns: v.id('folders'),
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

    const trimmedName = validateFolderName(args.name);

    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.organizationId !== args.organizationId) {
        throw new Error('Parent folder not found');
      }
    }

    await checkDuplicateName(
      ctx,
      args.organizationId,
      args.parentId,
      trimmedName,
    );

    return ctx.db.insert('folders', {
      organizationId: args.organizationId,
      name: trimmedName,
      parentId: args.parentId,
      teamId: args.teamId,
      createdBy: String(authUser._id),
    });
  },
});

export const renameFolder = mutation({
  args: {
    folderId: v.id('folders'),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      throw new Error('Folder not found');
    }

    await getOrganizationMember(ctx, folder.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const trimmedName = validateFolderName(args.name);

    await checkDuplicateName(
      ctx,
      folder.organizationId,
      folder.parentId,
      trimmedName,
      args.folderId,
    );

    await ctx.db.patch(args.folderId, { name: trimmedName });
    return null;
  },
});

export const deleteFolder = mutation({
  args: {
    folderId: v.id('folders'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      throw new Error('Folder not found');
    }

    await getOrganizationMember(ctx, folder.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const childFolder = await ctx.db
      .query('folders')
      .withIndex('by_org_parent_name', (q) =>
        q
          .eq('organizationId', folder.organizationId)
          .eq('parentId', args.folderId),
      )
      .first();

    if (childFolder) {
      throw new Error('Cannot delete folder with subfolders');
    }

    const childDoc = await ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_folderId', (q) =>
        q
          .eq('organizationId', folder.organizationId)
          .eq('folderId', args.folderId),
      )
      .first();

    if (childDoc) {
      throw new Error('Cannot delete folder with documents');
    }

    await ctx.db.delete(args.folderId);
    return null;
  },
});
