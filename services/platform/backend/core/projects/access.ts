/**
 * Project access control helper.
 *
 * A project's audience is its `teamIds` — the ONE rule every team-scoped
 * resource follows (`core/lib/audience.ts`): empty = organization-wide,
 * otherwise a member of any listed team; owners and admins always.
 *
 * Access rules:
 * - Org admins/owners always have full access.
 * - Projects with no team (org-wide) are readable by all members.
 * - Members of any team in the audience get canRead, and canEdit when their
 *   org role is an editor role (editor+ writes to any project they can read).
 * - Only admins/owners can administer (audience changes, delete, archive).
 *
 * The legacy pair `teamId` (owning team) + `sharedWithTeamIds` is the
 * previous spelling of the same audience; readers still accept it so a row
 * the previous image wrote during a rollout (array still empty) keeps its
 * restriction.
 */

import {
  ADMIN_ROLES,
  canSeeAudience,
  normalizeTeamIds,
} from '../lib/audience.ts';

export { ADMIN_ROLES };

interface ProjectAccessInput {
  /** The audience; empty = organization-wide. Preferred when present. */
  teamIds?: readonly string[];
  /** @deprecated Legacy owning team — read only while `teamIds` is empty. */
  teamId?: string | null;
  /** @deprecated Legacy shared teams — read only while `teamIds` is empty. */
  sharedWithTeamIds?: readonly string[];
}

export interface ProjectAccessResult {
  canRead: boolean;
  canEdit: boolean;
  canAdminister: boolean;
}

/** Org roles whose project access resolves to `canEdit` — the same set the
 * client-side pickers use to filter designation candidates (reviewer picker). */
export const EDITOR_ROLES = new Set(['owner', 'admin', 'developer', 'editor']);

/**
 * The effective audience of a project: the array when it carries one, else
 * the legacy pair (owning team first, then the shared teams). Empty for an
 * organization-wide project.
 */
export function getProjectTeamIds(
  project: ProjectAccessInput | null,
): string[] {
  if (!project) return [];
  if (project.teamIds !== undefined && project.teamIds.length > 0) {
    return normalizeTeamIds(project.teamIds);
  }
  return normalizeTeamIds([
    ...(project.teamId ? [project.teamId] : []),
    ...(project.sharedWithTeamIds ?? []),
  ]);
}

/**
 * Check whether a project is org-wide (visible to all org members).
 */
export function isOrgWideProject(project: ProjectAccessInput | null): boolean {
  return getProjectTeamIds(project).length === 0;
}

/**
 * Check whether the user has any access to the project.
 */
export function hasProjectAccess(
  project: ProjectAccessInput | null,
  userTeamIds: readonly string[] | Set<string>,
  userRole: string,
): boolean {
  if (userRole === 'disabled') return false;
  return canSeeAudience(
    { teamIds: getProjectTeamIds(project) },
    { role: userRole, teamIds: [...userTeamIds] },
  );
}

/**
 * Full access matrix for a project.
 */
export function checkProjectAccess(
  project: ProjectAccessInput | null,
  userTeamIds: readonly string[],
  userRole: string,
): ProjectAccessResult {
  if (userRole === 'disabled') {
    return { canRead: false, canEdit: false, canAdminister: false };
  }
  if (ADMIN_ROLES.has(userRole)) {
    return { canRead: true, canEdit: true, canAdminister: true };
  }
  if (!hasProjectAccess(project, userTeamIds, userRole)) {
    return { canRead: false, canEdit: false, canAdminister: false };
  }
  const canEdit = EDITOR_ROLES.has(userRole);
  return { canRead: true, canEdit, canAdminister: false };
}

/**
 * Whether a specific agent may be assigned or run in a project. A project in
 * `agentMode: 'restricted'` only permits its `allowedAgentSlugs`; any other mode
 * ('all' / unset) permits every org agent. Liveness (installed + enabled) is a
 * separate gate (`assertAgentAssigneeLive`).
 */
export function isAgentAllowedByProject(
  project: { agentMode?: string; allowedAgentSlugs?: string[] },
  agentSlug: string,
): boolean {
  if (project.agentMode !== 'restricted') return true;
  return (project.allowedAgentSlugs ?? []).includes(agentSlug);
}
