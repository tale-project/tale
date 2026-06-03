/**
 * Project access control helper.
 *
 * Mirrors the agent access pattern (`agents/access.ts`) for projects.
 * Decides whether a user can read, edit, or administer a project based on
 * team membership and organization role.
 *
 * Access rules:
 * - Org admins/owners always have full access.
 * - Projects with no team assignment (org-wide) are readable by all members.
 * - Owning team members get canRead + canEdit.
 * - Shared team members get canRead + canEdit.
 *   (Per the plan: editor+ in the org can write to any project they can read.)
 * - Only admins/owners can administer (sharing changes, delete, archive).
 */

interface ProjectAccessInput {
  teamId?: string | null;
  sharedWithTeamIds?: string[];
}

export interface ProjectAccessResult {
  canRead: boolean;
  canEdit: boolean;
  canAdminister: boolean;
}

export const ADMIN_ROLES = new Set(['owner', 'admin']);
const EDITOR_ROLES = new Set(['owner', 'admin', 'developer', 'editor']);

/**
 * Get the effective set of team IDs for a project.
 *
 * Returns an empty array for org-wide projects (no team restriction).
 */
export function getProjectTeamIds(
  project: ProjectAccessInput | null,
): string[] {
  if (!project) return [];

  const teams = new Set<string>();
  if (project.teamId) teams.add(project.teamId);
  if (project.sharedWithTeamIds) {
    for (const id of project.sharedWithTeamIds) {
      teams.add(id);
    }
  }
  return [...teams];
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
  userTeamIds: string[] | Set<string>,
  userRole: string,
): boolean {
  if (userRole === 'disabled') return false;
  if (ADMIN_ROLES.has(userRole)) return true;

  const projectTeams = getProjectTeamIds(project);
  if (projectTeams.length === 0) return true; // org-wide

  const teamSet =
    userTeamIds instanceof Set ? userTeamIds : new Set(userTeamIds);
  return projectTeams.some((id) => teamSet.has(id));
}

/**
 * Full access matrix for a project.
 */
export function checkProjectAccess(
  project: ProjectAccessInput | null,
  userTeamIds: string[],
  userRole: string,
): ProjectAccessResult {
  if (userRole === 'disabled') {
    return { canRead: false, canEdit: false, canAdminister: false };
  }
  const isAdmin = ADMIN_ROLES.has(userRole);
  if (isAdmin) {
    return { canRead: true, canEdit: true, canAdminister: true };
  }

  const hasAccess = hasProjectAccess(project, userTeamIds, userRole);
  if (!hasAccess) {
    return { canRead: false, canEdit: false, canAdminister: false };
  }

  const canEdit = EDITOR_ROLES.has(userRole);
  return { canRead: true, canEdit, canAdminister: false };
}
