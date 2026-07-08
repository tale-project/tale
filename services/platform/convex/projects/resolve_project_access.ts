/**
 * Ctx-bound project access resolution shared by every project-scoped
 * resource (documents, folders). Wraps the pure `checkProjectAccess` with
 * the lookups a resource guard needs: project fetch + org check, member
 * role, team ids — and fails CLOSED (no access) on any resolution error.
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { checkProjectAccess, type ProjectAccessResult } from './access';

export const NO_PROJECT_ACCESS: ProjectAccessResult = {
  canRead: false,
  canEdit: false,
  canAdminister: false,
};

/**
 * Resolve the caller's access matrix on a project by id.
 *
 * A dangling projectId (project deleted / foreign org) resolves to
 * NO_PROJECT_ACCESS so the owning resource stays locked rather than
 * silently falling open to org-wide. Costs a member + team lookup — for
 * single-resource paths, not per-row list filtering.
 */
export async function resolveProjectAccessForUser(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<'projects'>,
  args: { userId: string; organizationId: string },
): Promise<ProjectAccessResult> {
  const project = await ctx.db.get(projectId);
  if (!project || project.organizationId !== args.organizationId) {
    return NO_PROJECT_ACCESS;
  }

  try {
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
      email: undefined,
      name: undefined,
    });
    const userTeamIds = await getUserTeamIds(ctx, member.userId);
    return checkProjectAccess(project, userTeamIds, member.role);
  } catch (err) {
    // Membership resolution failing (user removed mid-request, auth mirror
    // miss) means no provable access — deny rather than leak.
    console.warn(
      '[projects/resolve_project_access] membership resolve failed',
      err instanceof Error ? err.message : err,
    );
    return NO_PROJECT_ACCESS;
  }
}
