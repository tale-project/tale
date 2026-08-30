import { v } from 'convex/values';

import { AppError } from '../../lib/shared/errors/app-error';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { mutation } from '../_generated/server';
import { recordTrashRefusal } from '../documents/access';
import { teamIdsToFields } from '../documents/team_fields';
import { type ActiveHolds, loadActiveHolds } from '../governance/legal_hold';
import { assertNotHeld } from '../governance/legal_hold_guard';
import { getUserTeamIds } from '../lib/get_user_teams';
import { checkOrganizationRateLimit } from '../lib/rate_limiter/helpers';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { hasTeamAccess } from '../lib/team_access';
import { deactivateSyncConfigsForPath } from '../onedrive/deactivate_sync_configs';
import { resolveProjectAccessForUser } from '../projects/resolve_project_access';
import { checkProjectFolderAccess, isProjectScopedFolder } from './access';
import { buildFolderPath } from './queries';

type TeamFields = {
  teamId: string | undefined;
  teamTags: string[] | undefined;
};

/** Documents per scheduled corpus scope-sync call — keeps one call's argument
 * payload and its SQL loop small when a team cascade touches a big tree. */
const SCOPE_SYNC_CHUNK = 100;

async function cascadeTeamToDescendants(
  ctx: MutationCtx,
  folderId: Id<'folders'>,
  organizationId: string,
  fields: TeamFields,
  /** Documents whose team scope this cascade rewrote — the caller syncs their
   * corpus rows so retrieval scoping follows the new teams. */
  touchedDocIds: Id<'documents'>[],
) {
  const childFolders = ctx.db
    .query('folders')
    .withIndex('by_org_parent_name', (q) =>
      q.eq('organizationId', organizationId).eq('parentId', folderId),
    );

  for await (const child of childFolders) {
    await ctx.db.patch(child._id, fields);
    await cascadeTeamToDescendants(
      ctx,
      child._id,
      organizationId,
      fields,
      touchedDocIds,
    );
  }

  const childDocs = ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderId', (q) =>
      q.eq('organizationId', organizationId).eq('folderId', folderId),
    );

  for await (const doc of childDocs) {
    await ctx.db.patch(doc._id, fields);
    if (doc.fileId) touchedDocIds.push(doc._id);
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
      throw new AppError({
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

/**
 * Controlled-record twin of {@link assertNoHeldDescendantDocs}: walk every
 * descendant document of `folderId` and throw if any refuses trashing per
 * `recordTrashRefusal` — frozen (in_review/approved) AND retained
 * (draft with approved history; direct delete refuses these, so the cascade
 * must too or the folder becomes a retention bypass). The cascade below
 * schedules `deleteDocumentFromRag`, which forwards to `deleteDocumentById`
 * WITHOUT `callerOrgId` — so its `assertRecordTrashable` gate never fires on
 * this path; this synchronous pre-walk is the gate. Never-approved drafts
 * and uncontrolled documents keep deleting exactly as today.
 */
async function assertNoProtectedDescendantRecords(
  ctx: MutationCtx,
  folderId: Id<'folders'>,
  organizationId: string,
): Promise<void> {
  const childFolders = ctx.db
    .query('folders')
    .withIndex('by_org_parent_name', (q) =>
      q.eq('organizationId', organizationId).eq('parentId', folderId),
    );
  for await (const child of childFolders) {
    await assertNoProtectedDescendantRecords(ctx, child._id, organizationId);
  }
  const childDocs = ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderId', (q) =>
      q.eq('organizationId', organizationId).eq('folderId', folderId),
    );
  for await (const doc of childDocs) {
    const refusal = recordTrashRefusal(doc.record);
    if (refusal === null) continue;
    throw new AppError({
      code: 'DOCUMENT_RECORD_PROTECTED',
      message:
        refusal === 'in_review'
          ? 'A controlled record inside this folder is in review and cannot be deleted. Resolve the review before deleting the folder.'
          : refusal === 'approved'
            ? 'A controlled record inside this folder is approved and cannot be deleted. Open a new revision first if it must change.'
            : 'A controlled record inside this folder has an approved version in its history, which is a retained record, so the folder cannot be deleted.',
      state: doc.record?.state,
      documentId: String(doc._id),
    });
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

/**
 * Rename/delete gate, scope-aware: project folders require edit access to
 * the owning project (the same standard as project document mutations);
 * hub folders follow team rules.
 */
async function assertFolderMutable(
  ctx: MutationCtx,
  folder: Doc<'folders'>,
  userId: string,
): Promise<void> {
  if (isProjectScopedFolder(folder)) {
    const access = await checkProjectFolderAccess(ctx, folder, {
      userId,
      organizationId: folder.organizationId,
    });
    if (!access?.canEdit) {
      throw new AppError({ code: 'PROJECT_FORBIDDEN' });
    }
    return;
  }
  if (folder.teamId || folder.teamTags?.length) {
    const userTeamIds = await getUserTeamIds(ctx, userId);
    if (!hasTeamAccess(folder, userTeamIds)) {
      throw new AppError({
        code: 'FOLDER_ACCESS_DENIED',
        message: 'Access denied',
      });
    }
  }
}

const MAX_FOLDER_NAME_LENGTH = 255;
export const MAX_FOLDER_DEPTH = 20;
const RESERVED_NAMES = new Set(['.', '..']);

export function validateFolderName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new AppError({
      code: 'FOLDER_NAME_EMPTY',
      message: 'Folder name cannot be empty',
    });
  }
  if (trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    throw new AppError({
      code: 'FOLDER_NAME_TOO_LONG',
      message: 'Folder name is too long',
    });
  }
  if (RESERVED_NAMES.has(trimmed)) {
    throw new AppError({
      code: 'FOLDER_NAME_INVALID',
      message: 'Invalid folder name',
    });
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new AppError({
      code: 'FOLDER_NAME_HAS_SEPARATOR',
      message: 'Folder name cannot contain path separators',
    });
  }
  return trimmed;
}

/**
 * The sibling already holding `(org, project scope, parent, name)`, if any —
 * the one probe the session duplicate guard and the REST get-or-create door
 * (`folders/internal_mutations.getOrCreateProjectFolder`) share, so "same
 * folder" can never mean two different things.
 */
export async function findSiblingFolder(
  ctx: MutationCtx,
  organizationId: string,
  projectId: Id<'projects'> | undefined,
  parentId: Id<'folders'> | undefined,
  name: string,
): Promise<Doc<'folders'> | null> {
  // Uniqueness is per scope: a hub folder and a project folder (or folders
  // in two different projects) may share (org, parent, name) at the root.
  return await ctx.db
    .query('folders')
    .withIndex('by_org_project_parent_name', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('projectId', projectId)
        .eq('parentId', parentId)
        .eq('name', name),
    )
    .first();
}

/**
 * Refuse a child under `parent` when the chain is already at
 * `MAX_FOLDER_DEPTH` — the same walk `createFolder` has always run, shared
 * with the REST get-or-create door. Throws `FOLDER_MAX_DEPTH_EXCEEDED`.
 */
export async function assertChildDepthAllowed(
  ctx: MutationCtx,
  parent: Doc<'folders'>,
): Promise<void> {
  let depth = 1;
  let ancestorId = parent.parentId;
  while (ancestorId && depth < MAX_FOLDER_DEPTH) {
    const ancestor = await ctx.db.get(ancestorId);
    if (!ancestor) break;
    depth++;
    ancestorId = ancestor.parentId;
  }
  if (depth >= MAX_FOLDER_DEPTH) {
    throw new AppError({
      code: 'FOLDER_MAX_DEPTH_EXCEEDED',
      message: 'Maximum folder nesting depth exceeded',
    });
  }
}

async function checkDuplicateName(
  ctx: MutationCtx,
  organizationId: string,
  parentId: Id<'folders'> | undefined,
  name: string,
  excludeId?: Id<'folders'>,
  projectId?: Id<'projects'>,
) {
  const existing = await findSiblingFolder(
    ctx,
    organizationId,
    projectId,
    parentId,
    name,
  );

  if (existing && existing._id !== excludeId) {
    throw new AppError({
      code: 'FOLDER_DUPLICATE_NAME',
      message: 'A folder with this name already exists',
    });
  }
}

export const createFolder = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    parentId: v.optional(v.id('folders')),
    teamId: v.optional(v.string()),
    // Create a project-scoped folder. Mutually exclusive with teamId (the
    // documents.projectId invariant, extended to folders). Requires edit
    // access to the project.
    projectId: v.optional(v.id('projects')),
  },
  returns: v.id('folders'),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new AppError({ code: 'UNAUTHENTICATED' });
    }

    await getOrganizationMember(ctx, args.organizationId, authUser);

    await checkOrganizationRateLimit(ctx, 'folder:mutate', args.organizationId);

    const trimmedName = validateFolderName(args.name);

    if (args.projectId && args.teamId) {
      throw new AppError({
        code: 'FOLDER_SCOPE_CONFLICT',
        message: 'A project folder cannot also carry a team',
      });
    }

    let effectiveTeamId = args.teamId;
    let effectiveProjectId = args.projectId;

    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.organizationId !== args.organizationId) {
        throw new AppError({
          code: 'FOLDER_PARENT_NOT_FOUND',
          message: 'Parent folder not found',
        });
      }
      // Scope is inherited from the parent and may not be changed by the
      // child: a subfolder of a project folder is a folder of that project;
      // a hub parent cannot hold a project child (and vice versa).
      if (args.projectId && parent.projectId !== args.projectId) {
        throw new AppError({
          code: 'FOLDER_SCOPE_CONFLICT',
          message: 'Parent folder belongs to a different scope',
        });
      }
      effectiveProjectId = parent.projectId ?? args.projectId;
      if (!isProjectScopedFolder(parent)) {
        if (parent.teamId || parent.teamTags?.length) {
          const userTeamIds = await getUserTeamIds(ctx, authUser.userId);
          if (!hasTeamAccess(parent, userTeamIds)) {
            throw new AppError({
              code: 'FOLDER_PARENT_NOT_ACCESSIBLE',
              message: 'Parent folder not accessible',
            });
          }
        }

        if (parent.teamId) {
          effectiveTeamId = parent.teamId;
        }
      }

      await assertChildDepthAllowed(ctx, parent);
    }

    if (effectiveProjectId) {
      // Project folders carry no team fields (mutual exclusivity) and are
      // gated by project edit access — the same standard as adding a file
      // to the project.
      effectiveTeamId = undefined;
      const access = await resolveProjectAccessForUser(
        ctx,
        effectiveProjectId,
        { userId: authUser.userId, organizationId: args.organizationId },
      );
      if (!access.canRead) {
        throw new AppError({
          code: 'PROJECT_FORBIDDEN',
          message: 'You do not have access to this project',
        });
      }
      if (!access.canEdit) {
        throw new AppError({
          code: 'RBAC_FORBIDDEN',
          message: 'You do not have permission to add folders to this project',
        });
      }
    } else if (effectiveTeamId) {
      const userTeamIds = await getUserTeamIds(ctx, authUser.userId);
      if (!userTeamIds.includes(effectiveTeamId)) {
        throw new AppError({
          code: 'FOLDER_TEAM_FORBIDDEN',
          message: 'Cannot create folder in a team you do not belong to',
        });
      }
    }

    await checkDuplicateName(
      ctx,
      args.organizationId,
      args.parentId,
      trimmedName,
      undefined,
      effectiveProjectId,
    );

    return ctx.db.insert('folders', {
      organizationId: args.organizationId,
      name: trimmedName,
      parentId: args.parentId,
      teamId: effectiveTeamId,
      projectId: effectiveProjectId,
      createdBy: authUser.userId,
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new AppError({ code: 'UNAUTHENTICATED' });
    }

    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      throw new AppError({
        code: 'FOLDER_NOT_FOUND',
        message: 'Folder not found',
      });
    }

    await getOrganizationMember(ctx, folder.organizationId, authUser);

    await checkOrganizationRateLimit(
      ctx,
      'folder:mutate',
      folder.organizationId,
    );

    await assertFolderMutable(ctx, folder, authUser.userId);

    const trimmedName = validateFolderName(args.name);

    await checkDuplicateName(
      ctx,
      folder.organizationId,
      folder.parentId,
      trimmedName,
      args.folderId,
      folder.projectId,
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new AppError({ code: 'UNAUTHENTICATED' });
    }

    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      throw new AppError({
        code: 'FOLDER_NOT_FOUND',
        message: 'Folder not found',
      });
    }

    await getOrganizationMember(ctx, folder.organizationId, authUser);

    await checkOrganizationRateLimit(
      ctx,
      'folder:mutate',
      folder.organizationId,
    );

    await assertFolderMutable(ctx, folder, authUser.userId);

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
    // Controlled-record gate, same up-front stance: the async cascade
    // bypasses `assertRecordTrashable` (no `callerOrgId`), so a descendant
    // record that refuses trashing (in_review/approved, or a draft retaining
    // approved history) must refuse the WHOLE folder delete here, before
    // anything is removed.
    await assertNoProtectedDescendantRecords(
      ctx,
      args.folderId,
      folder.organizationId,
    );

    // Deleting a synced folder means "stop syncing it" — deactivate any
    // config targeting this folder (or a descendant) before the cascade, or
    // the next sync run would recreate everything just removed.
    const folderPath = await buildFolderPath(ctx, args.folderId);
    if (folderPath) {
      await deactivateSyncConfigsForPath(
        ctx,
        folder.organizationId,
        folderPath,
      );
    }

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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new AppError({ code: 'UNAUTHENTICATED' });
    }

    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      throw new AppError({
        code: 'FOLDER_NOT_FOUND',
        message: 'Folder not found',
      });
    }

    await getOrganizationMember(ctx, folder.organizationId, authUser);

    await checkOrganizationRateLimit(
      ctx,
      'folder:mutate',
      folder.organizationId,
    );

    // Team assignment is a Knowledge Hub concept — a project folder never
    // carries teams (projectId/teamId mutual exclusivity).
    if (isProjectScopedFolder(folder)) {
      throw new AppError({
        code: 'FOLDER_SCOPE_CONFLICT',
        message: 'A project folder cannot be assigned to teams',
      });
    }

    if (folder.parentId) {
      const parent = await ctx.db.get(folder.parentId);
      if (parent?.teamId) {
        throw new AppError({
          code: 'FOLDER_TEAM_INHERITED',
          message: 'Cannot change team: inherited from parent folder',
        });
      }
    }

    const userTeamIds = await getUserTeamIds(ctx, authUser.userId);

    if (folder.teamId || folder.teamTags?.length) {
      if (!hasTeamAccess(folder, userTeamIds)) {
        throw new AppError({
          code: 'FOLDER_ACCESS_DENIED',
          message: 'Access denied',
        });
      }
    }

    for (const tid of args.teamIds) {
      if (!userTeamIds.includes(tid)) {
        throw new AppError({
          code: 'FOLDER_TEAM_FORBIDDEN',
          message: 'Cannot assign folder to a team you do not belong to',
        });
      }
    }

    const { teamId, teamTags } = teamIdsToFields(
      args.teamIds.length > 0 ? args.teamIds : undefined,
    );

    await ctx.db.patch(args.folderId, { teamId, teamTags });

    const touchedDocIds: Id<'documents'>[] = [];
    await cascadeTeamToDescendants(
      ctx,
      args.folderId,
      folder.organizationId,
      { teamId, teamTags },
      touchedDocIds,
    );

    // The cascade is a SCOPE change for every document it touched: retrieval
    // filters on the corpus row's team_id, so it must follow — scope-only,
    // no re-embed. Chunked so one huge tree never overflows a scheduler arg.
    for (let at = 0; at < touchedDocIds.length; at += SCOPE_SYNC_CHUNK) {
      await ctx.scheduler.runAfter(
        0,
        internal.documents.internal_actions.syncRagDocumentScopes,
        {
          organizationId: folder.organizationId,
          documentIds: touchedDocIds.slice(at, at + SCOPE_SYNC_CHUNK),
        },
      );
    }

    return null;
  },
});
