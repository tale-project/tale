import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import {
  checkOrganizationRateLimit,
  RateLimitExceededError,
} from '../lib/rate_limiter/helpers';
import { resolveProjectAccessForUser } from '../projects/resolve_project_access';
import { getOrCreateFolderPath as getOrCreateFolderPathHelper } from './get_or_create_path';
import {
  assertChildDepthAllowed,
  findSiblingFolder,
  validateFolderName,
} from './mutations';

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

interface GetOrCreateProjectFolderResult {
  folderId: Id<'folders'>;
  name: string;
  created: boolean;
}

/**
 * The one project-folder get-or-create core: the project edit gate re-run
 * with the EXPLICIT `userId`'s identity (never org-role-only), the session
 * path's name/depth checks via the shared helpers, and the exact-name sibling
 * probe (`findSiblingFolder` — the same probe `createFolder`'s duplicate
 * guard uses) deciding reuse vs insert. Shared by the automation-Forms root
 * lane and the projects REST door so the two can never drift.
 *
 * A parent that is missing, in another org, or in another project reads as an
 * opaque `FOLDER_NOT_FOUND` — a caller must not learn other scopes' folders
 * exist through this door.
 */
async function getOrCreateProjectFolderCore(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    projectId: Id<'projects'>;
    name: string;
    userId: string;
    parentId?: Id<'folders'>;
  },
): Promise<GetOrCreateProjectFolderResult> {
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

  if (args.parentId) {
    const parent = await ctx.db.get(args.parentId);
    if (
      !parent ||
      parent.organizationId !== args.organizationId ||
      parent.projectId !== args.projectId
    ) {
      throw new ConvexError({
        code: 'FOLDER_NOT_FOUND',
        message: 'Folder not found',
      });
    }
    await assertChildDepthAllowed(ctx, parent);
  }

  const existing = await findSiblingFolder(
    ctx,
    args.organizationId,
    args.projectId,
    args.parentId,
    trimmedName,
  );
  if (existing) {
    return { folderId: existing._id, name: existing.name, created: false };
  }

  const folderId = await ctx.db.insert('folders', {
    organizationId: args.organizationId,
    name: trimmedName,
    projectId: args.projectId,
    parentId: args.parentId,
    createdBy: args.userId,
  });
  return { folderId, name: trimmedName, created: true };
}

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
  handler: async (
    ctx,
    args,
  ): Promise<{ folderId: Id<'folders'>; created: boolean }> => {
    const result = await getOrCreateProjectFolderCore(ctx, args);
    return { folderId: result.folderId, created: result.created };
  },
});

/**
 * Get-or-create a project folder (root or nested) on behalf of an explicit
 * user — the backing mutation of `POST /api/v1/projects/{id}/folders`. Same
 * core as `getOrCreateProjectRootFolder`, plus the per-org `folder:mutate`
 * charge the session `createFolder` pays (mapped to the coded `RATE_LIMITED`
 * so the REST wrapper answers 429 + Retry-After). Ids arrive as wire strings:
 * garbage collapses into the same opaque refusals as absence.
 */
export const getOrCreateProjectFolder = internalMutation({
  args: {
    organizationId: v.string(),
    projectId: v.string(),
    name: v.string(),
    userId: v.string(),
    parentId: v.optional(v.string()),
  },
  returns: v.object({
    folderId: v.id('folders'),
    name: v.string(),
    created: v.boolean(),
  }),
  handler: async (ctx, args): Promise<GetOrCreateProjectFolderResult> => {
    const projectId = ctx.db.normalizeId('projects', args.projectId);
    if (projectId === null) {
      throw new ConvexError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
      });
    }
    let parentId: Id<'folders'> | undefined;
    if (args.parentId !== undefined) {
      const normalized = ctx.db.normalizeId('folders', args.parentId);
      if (normalized === null) {
        throw new ConvexError({
          code: 'FOLDER_NOT_FOUND',
          message: 'Folder not found',
        });
      }
      parentId = normalized;
    }

    try {
      await checkOrganizationRateLimit(
        ctx,
        'folder:mutate',
        args.organizationId,
      );
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        throw new ConvexError({
          code: 'RATE_LIMITED',
          message: error.message,
          retryAfterMs: error.retryAfter,
        });
      }
      throw error;
    }

    return await getOrCreateProjectFolderCore(ctx, {
      organizationId: args.organizationId,
      projectId,
      name: args.name,
      userId: args.userId,
      parentId,
    });
  },
});
