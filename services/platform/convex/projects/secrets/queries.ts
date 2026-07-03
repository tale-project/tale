import { ConvexError, v } from 'convex/values';

import type { Id } from '../../_generated/dataModel';
import { query, type QueryCtx } from '../../_generated/server';
import { getUserTeamIds } from '../../lib/get_user_teams';
import { getAuthUserIdentity } from '../../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../../lib/rls/organization/get_organization_member';
import { checkProjectAccess } from '../access';

async function assertProjectAdmin(
  ctx: QueryCtx,
  projectId: Id<'projects'>,
): Promise<void> {
  const project = await ctx.db.get(projectId);
  if (!project) throw new ConvexError({ code: 'PROJECT_NOT_FOUND' });
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });
  const member = await getOrganizationMember(
    ctx,
    project.organizationId,
    authUser,
  );
  const teamIds = await getUserTeamIds(ctx, member.userId);
  if (!checkProjectAccess(project, teamIds, member.role).canAdminister) {
    throw new ConvexError({ code: 'PROJECT_FORBIDDEN' });
  }
}

/**
 * List project secret METADATA (never values). Project-admin only — secrets are
 * sensitive even at the name level. Used by the Secrets tab.
 */
export const listProjectSecrets = query({
  args: { projectId: v.id('projects') },
  returns: v.array(
    v.object({
      name: v.string(),
      description: v.optional(v.string()),
      updatedAt: v.number(),
      updatedBy: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await assertProjectAdmin(ctx, args.projectId);
    const project = await ctx.db.get(args.projectId);
    if (!project) return [];
    const secrets: Array<{
      name: string;
      description?: string;
      updatedAt: number;
      updatedBy: string;
    }> = [];
    for await (const row of ctx.db
      .query('projectSecrets')
      .withIndex('by_project', (q) =>
        q
          .eq('organizationId', project.organizationId)
          .eq('projectId', args.projectId),
      )) {
      secrets.push({
        name: row.name,
        description: row.description,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      });
    }
    return secrets;
  },
});
