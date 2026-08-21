/**
 * Internal mutations for the projects feature — the machine-door twins of the
 * session mutations. Each takes an EXPLICIT `userId` (the REST API key
 * holder, already authenticated by `withRestAuth`) and re-runs the same
 * gates the session path applies before delegating to the shared core, so
 * the two surfaces can never drift.
 */

import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';
import { checkUserRateLimit } from '../lib/rate_limiter/helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { EDITOR_ROLES } from './access';
import { createProjectCore, mapRateLimitError } from './mutations';

/**
 * Create a project on behalf of an explicit user — the backing mutation of
 * `POST /api/v1/projects`. Same editor-role gate, the same per-user
 * `project:create` charge, and the SAME validation/uniqueness core as the
 * session `createProject`; only authentication differs (the REST wrapper
 * already proved the key). Returns the projection the REST response carries.
 */
export const createProjectForUser = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    /** Actor email for the audit trail (the key holder's, when known). */
    userEmail: v.optional(v.string()),
    name: v.string(),
    key: v.optional(v.string()),
    description: v.optional(v.string()),
    externalItemId: v.optional(v.string()),
  },
  returns: v.object({
    id: v.id('projects'),
    name: v.string(),
    key: v.optional(v.string()),
    description: v.optional(v.string()),
    externalItemId: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    id: Id<'projects'>;
    name: string;
    key?: string;
    description?: string;
    externalItemId?: string;
  }> => {
    // Membership + the same editor set the session mutation admits
    // (EDITOR_ROLES is the canonical `canEdit` set in `access.ts`).
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
      email: args.userEmail,
      name: undefined,
    });
    if (!EDITOR_ROLES.has(member.role)) {
      throw new ConvexError({
        code: 'RBAC_FORBIDDEN',
        message: `Role "${member.role}" cannot create projects`,
      });
    }

    try {
      await checkUserRateLimit(ctx, 'project:create', args.userId);
    } catch (error) {
      mapRateLimitError(error);
    }

    const projectId = await createProjectCore(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
      userEmail: args.userEmail,
      name: args.name,
      key: args.key,
      description: args.description,
      externalItemId: args.externalItemId,
      // Machine callers have no interactive way out of a derived-key clash:
      // suffix it (or go keyless for underivable names) instead of 409ing.
      deriveKeyOnCollision: true,
    });

    const project = await ctx.db.get(projectId);
    if (!project) {
      // Unreachable — the core just inserted it — but fail loudly over
      // returning a fabricated projection.
      throw new ConvexError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
      });
    }
    return {
      id: project._id,
      name: project.name,
      key: project.key,
      description: project.description,
      externalItemId: project.externalItemId,
    };
  },
});
