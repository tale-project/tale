/**
 * Ctx-bound project access resolution shared by every project-scoped
 * resource (documents, folders). Wraps the pure `checkProjectAccess` with
 * the lookups a resource guard needs: project fetch + org check, member
 * role, team ids — and fails CLOSED (no access) on any resolution error.
 */

import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import {
  checkProjectAccess,
  hasProjectAccess,
  isAgentAllowedByProject,
  type ProjectAccessResult,
} from './access';

export const NO_PROJECT_ACCESS: ProjectAccessResult = {
  canRead: false,
  canEdit: false,
  canAdminister: false,
};

/**
 * Resolve a user's org role + team IDs, or `null` when that can't be proven
 * (user removed mid-request, auth mirror miss). Shared by the project-access
 * resolvers below; fails CLOSED so a resolution error never leaks access.
 */
export async function resolveUserAccessContext(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  userId: string,
): Promise<{ role: string; teamIds: string[] } | null> {
  try {
    const member = await getOrganizationMember(ctx, organizationId, {
      userId,
      email: undefined,
      name: undefined,
    });
    const teamIds = await getUserTeamIds(ctx, member.userId);
    return { role: member.role, teamIds };
  } catch (err) {
    console.warn(
      '[projects/resolve_project_access] user access context resolve failed',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

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
  const context = await resolveUserAccessContext(
    ctx,
    args.organizationId,
    args.userId,
  );
  if (!context) return NO_PROJECT_ACCESS;
  return checkProjectAccess(project, context.teamIds, context.role);
}

/**
 * Guard a HUMAN task assignee: they must be able to read the project they'd be
 * assigned work in. Self-assignment is always allowed — the caller already
 * passed the project's write gate. Throws `ASSIGNEE_NO_PROJECT_ACCESS`.
 */
export async function assertHumanAssigneeAccess(
  ctx: QueryCtx | MutationCtx,
  args: {
    project: Doc<'projects'>;
    organizationId: string;
    assigneeId: string;
    callerId: string;
  },
): Promise<void> {
  if (args.assigneeId === args.callerId) return;
  const context = await resolveUserAccessContext(
    ctx,
    args.organizationId,
    args.assigneeId,
  );
  if (
    context &&
    hasProjectAccess(args.project, context.teamIds, context.role)
  ) {
    return;
  }
  throw new ConvexError({ code: 'ASSIGNEE_NO_PROJECT_ACCESS' });
}

/**
 * Guard an AGENT task assignee against the project's agent restriction: a
 * `restricted`-mode project only permits its `allowedAgentSlugs`. Throws
 * `AGENT_NOT_ALLOWED_IN_PROJECT`. (Liveness is a separate gate,
 * `assertAgentAssigneeLive`.)
 */
export function assertAgentAssigneeAllowedByProject(
  project: Pick<Doc<'projects'>, 'agentMode' | 'allowedAgentSlugs'>,
  agentSlug: string,
): void {
  if (!isAgentAllowedByProject(project, agentSlug)) {
    throw new ConvexError({ code: 'AGENT_NOT_ALLOWED_IN_PROJECT' });
  }
}
