import { v } from 'convex/values';

import type { Id } from '../../_generated/dataModel';
import { query, type QueryCtx } from '../../_generated/server';
import { authComponent } from '../../auth';
import { getUserTeamIds } from '../../lib/get_user_teams';
import { getOrganizationMember } from '../../lib/rls';
import { checkProjectAccess } from '../access';

async function assertProjectAdmin(
  ctx: QueryCtx,
  projectId: Id<'projects'>,
): Promise<void> {
  const project = await ctx.db.get(projectId);
  if (!project) throw new Error('PROJECT_NOT_FOUND');
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) throw new Error('Unauthenticated');
  const member = await getOrganizationMember(ctx, project.organizationId, {
    userId: String(authUser._id),
    email: authUser.email,
    name: authUser.name,
  });
  const teamIds = await getUserTeamIds(ctx, member.userId);
  if (!checkProjectAccess(project, teamIds, member.role).canAdminister) {
    throw new Error('SECRET_FORBIDDEN');
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
    const rows = await ctx.db
      .query('projectSecrets')
      .withIndex('by_project', (q) =>
        q
          .eq('organizationId', project.organizationId)
          .eq('projectId', args.projectId),
      )
      .collect();
    return rows.map((row) => ({
      name: row.name,
      description: row.description,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    }));
  },
});
