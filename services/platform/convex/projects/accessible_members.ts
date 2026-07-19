/**
 * Reverse of `hasProjectAccess`: enumerate the user IDs that CAN access a
 * project, so an assignee picker / `@`-mention directory never offers a user who
 * cannot see the project (`use-actor-directory`, `tasks/directory.ts`).
 *
 * Reads the local membership mirrors (`memberMirror`, `teamMemberMirror`) — the
 * same source `getUserTeamIds` / `hasProjectAccess` resolve against — so the
 * reverse set and the forward gate always agree. Tenant-safe: team IDs come from
 * the org-scoped project, and every returned userId must appear in that org's
 * `memberMirror`.
 */

import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { ADMIN_ROLES, getProjectTeamIds } from './access';

/**
 * The set of user IDs with access to `project`, or `null` when the project is
 * org-wide (no team restriction) — callers treat `null` as "every non-disabled
 * member". For a team-scoped project the set is exactly the users for whom
 * `hasProjectAccess(project, theirTeams, theirRole)` is true: org admins/owners
 * (always) ∪ members of the project's team(s), minus `disabled` and stale
 * (no-longer-in-org) rows.
 */
export async function getProjectAccessibleUserIds(
  ctx: QueryCtx | MutationCtx,
  project: Doc<'projects'>,
): Promise<Set<string> | null> {
  const teamIds = getProjectTeamIds(project);
  if (teamIds.length === 0) return null; // org-wide

  // One pass over the org's members: role lookup + the admin/owner set (admins
  // always have access regardless of team). This also lets us drop stale
  // teamMemberMirror rows for users who have since left the org.
  const roleByUserId = new Map<string, string>();
  for await (const row of ctx.db
    .query('memberMirror')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', project.organizationId),
    )) {
    roleByUserId.set(row.userId, row.role);
  }

  const accessible = new Set<string>();
  for (const [userId, role] of roleByUserId) {
    if (ADMIN_ROLES.has(role)) accessible.add(userId);
  }

  for (const teamId of teamIds) {
    for await (const row of ctx.db
      .query('teamMemberMirror')
      .withIndex('by_teamId', (q) => q.eq('teamId', teamId))) {
      const role = roleByUserId.get(row.userId);
      // Skip users no longer in the org (stale mirror row) and disabled users —
      // both fail `hasProjectAccess`.
      if (role === undefined || role === 'disabled') continue;
      accessible.add(row.userId);
    }
  }

  return accessible;
}
