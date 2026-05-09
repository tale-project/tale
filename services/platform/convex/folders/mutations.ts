import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { teamIdsToFields } from '../documents/team_fields';
import { type ActiveHolds, loadActiveHolds } from '../governance/legal_hold';
import { assertNotHeld } from '../governance/legal_hold_guard';
import { getUserTeamIds } from '../lib/get_user_teams';
import { checkOrganizationRateLimit } from '../lib/rate_limiter/helpers';
import { getOrganizationMember } from '../lib/rls';
import { hasTeamAccess } from '../lib/team_access';

type TeamFields = {
  teamId: string | undefined;
  teamTags: string[] | undefined;
};

async function cascadeTeamToDescendants(
  ctx: MutationCtx,
  folderId: Id<'folders'>,
  organizationId: string,
  fields: TeamFields,
) {
  const childFolders = ctx.db
    .query('folders')
    .withIndex('by_org_parent_name', (q) =>
      q.eq('organizationId', organizationId).eq('parentId', folderId),
    );

  for await (const child of childFolders) {
    await ctx.db.patch(child._id, fields);
    await cascadeTeamToDescendants(ctx, child._id, organizationId, fields);
  }

  const childDocs = ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderId', (q) =>
      q.eq('organizationId', organizationId).eq('folderId', folderId),
    );

  for await (const doc of childDocs) {
    await ctx.db.patch(doc._id, fields);
  }
}

/**
 * Walk every descendant document of `folderId` and throw if any is on
 * legal hold. Run BEFORE any cascade delete so the folder hierarchy
 * isn't half-removed when a held doc is encountered partway through
 * (round-2 v08 B4 — folder cascade fix).
 */
async function assertNoHeldDescendantDocs(
  ctx: MutationCtx,
  folderId: Id<'folders'>,
  organizationId: string,
  holds: ActiveHolds,
): Promise<void> {
  const childFolders = ctx.db
    .query('folders')
    .withIndex('by_org_parent_name', (q) =>
      q.eq('organizationId', organizationId).eq('parentId', folderId),
    );
  for await (const child of childFolders) {
    await assertNoHeldDescendantDocs(ctx, child._id, organizationId, holds);
  }
  const childDocs = ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderId', (q) =>
      q.eq('organizationId', organizationId).eq('folderId', folderId),
    );
  for await (const doc of childDocs) {
    // Per-document hold target type was deprecated by the User+Org
    // pivot; the user-custodian cascade now triggers when any
    // descendant document's `createdBy` is on a userMembership hold.
    if (doc.createdBy && holds.userMembershipIds.has(doc.createdBy)) {
      throw new ConvexError({
        code: 'LEGAL_HOLD_ACTIVE',
        message:
          'A document inside this folder is owned by a user on a custodian legal hold. Release the user-level hold before deleting the folder.',
        targetType: 'document',
        targetId: String(doc._id),
        orgHeld: false,
        userCustodianHeld: true,
      });
    }
  }
}

async function deleteFolderContents(
  ctx: MutationCtx,
  folderId: Id<'folders'>,
  organizationId: string,
) {
  const childFolders = ctx.db
    .query('folders')
    .withIndex('by_org_parent_name', (q) =>
      q.eq('organizationId', organizationId).eq('parentId', folderId),
    );

  for await (const child of childFolders) {
    await deleteFolderContents(ctx, child._id, organizationId);
    await ctx.db.delete(child._id);
  }

  const childDocs = ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderId', (q) =>
      q.eq('organizationId', organizationId).eq('folderId', folderId),
    );

  for await (const doc of childDocs) {
    await ctx.scheduler.runAfter(
      0,
      internal.documents.internal_actions.deleteDocumentFromRag,
      { documentId: doc._id },
    );
  }
}

const MAX_FOLDER_NAME_LENGTH = 255;
const MAX_FOLDER_DEPTH = 20;
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

    await checkOrganizationRateLimit(ctx, 'folder:mutate', args.organizationId);

    const trimmedName = validateFolderName(args.name);

    let effectiveTeamId = args.teamId;

    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.organizationId !== args.organizationId) {
        throw new Error('Parent folder not found');
      }
      if (parent.teamId || parent.teamTags?.length) {
        const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
        if (!hasTeamAccess(parent, userTeamIds)) {
          throw new Error('Parent folder not accessible');
        }
      }

      if (parent.teamId) {
        effectiveTeamId = parent.teamId;
      }

      let depth = 1;
      let ancestorId = parent.parentId;
      while (ancestorId && depth < MAX_FOLDER_DEPTH) {
        const ancestor = await ctx.db.get(ancestorId);
        if (!ancestor) break;
        depth++;
        ancestorId = ancestor.parentId;
      }
      if (depth >= MAX_FOLDER_DEPTH) {
        throw new Error('Maximum folder nesting depth exceeded');
      }
    }

    if (effectiveTeamId) {
      const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
      if (!userTeamIds.includes(effectiveTeamId)) {
        throw new Error('Cannot create folder in a team you do not belong to');
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
      teamId: effectiveTeamId,
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

    await checkOrganizationRateLimit(
      ctx,
      'folder:mutate',
      folder.organizationId,
    );

    if (folder.teamId || folder.teamTags?.length) {
      const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
      if (!hasTeamAccess(folder, userTeamIds)) {
        throw new Error('Access denied');
      }
    }

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

    await checkOrganizationRateLimit(
      ctx,
      'folder:mutate',
      folder.organizationId,
    );

    if (folder.teamId || folder.teamTags?.length) {
      const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
      if (!hasTeamAccess(folder, userTeamIds)) {
        throw new Error('Access denied');
      }
    }

    // Hold gate: refuse the whole cascade up-front. Org-level holds throw
    // immediately; per-document holds throw after a synchronous descendant
    // walk (round-2 v08 B4). The pre-walk avoids the half-deleted state
    // where an async RAG-cleanup throws on a held doc but the parent
    // folder is already gone.
    await assertNotHeld(
      ctx,
      folder.organizationId,
      'folder',
      String(args.folderId),
    );
    const holds = await loadActiveHolds(ctx, folder.organizationId);
    await assertNoHeldDescendantDocs(
      ctx,
      args.folderId,
      folder.organizationId,
      holds,
    );

    await deleteFolderContents(ctx, args.folderId, folder.organizationId);
    await ctx.db.delete(args.folderId);
    return null;
  },
});

export const updateFolderTeams = mutation({
  args: {
    folderId: v.id('folders'),
    teamIds: v.array(v.string()),
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

    await checkOrganizationRateLimit(
      ctx,
      'folder:mutate',
      folder.organizationId,
    );

    if (folder.parentId) {
      const parent = await ctx.db.get(folder.parentId);
      if (parent?.teamId) {
        throw new Error('Cannot change team: inherited from parent folder');
      }
    }

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));

    if (folder.teamId || folder.teamTags?.length) {
      if (!hasTeamAccess(folder, userTeamIds)) {
        throw new Error('Access denied');
      }
    }

    for (const tid of args.teamIds) {
      if (!userTeamIds.includes(tid)) {
        throw new Error('Cannot assign folder to a team you do not belong to');
      }
    }

    const { teamId, teamTags } = teamIdsToFields(
      args.teamIds.length > 0 ? args.teamIds : undefined,
    );

    await ctx.db.patch(args.folderId, { teamId, teamTags });

    await cascadeTeamToDescendants(ctx, args.folderId, folder.organizationId, {
      teamId,
      teamTags,
    });

    return null;
  },
});
