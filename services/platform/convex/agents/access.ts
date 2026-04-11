/**
 * Agent access control helper.
 *
 * Determines whether a user can use, edit, or admin an agent
 * based on team membership and organization role.
 *
 * Access rules:
 * - Org admins/owners always have full access to all agents.
 * - Agents with no team assignment (org-wide) are usable by all members.
 * - Team-scoped agents are only usable by members of assigned teams.
 * - Edit/admin access requires org admin/owner role.
 */

interface AgentBinding {
  teamId?: string | null;
  sharedWithTeamIds?: string[];
}

interface AgentAccessResult {
  canUse: boolean;
  canEdit: boolean;
}

const ADMIN_ROLES = new Set(['owner', 'admin']);

/**
 * Check if a user has access to an agent.
 *
 * @param binding - The agent's DB binding (null if no binding exists)
 * @param userTeamIds - Team IDs the user belongs to
 * @param userRole - The user's organization role (owner, admin, member, etc.)
 * @param roleRestriction - Optional role restriction from agent JSON config
 */
export function checkAgentAccess(
  binding: AgentBinding | null,
  userTeamIds: string[],
  userRole: string,
  roleRestriction?: string,
): AgentAccessResult {
  const isAdmin = ADMIN_ROLES.has(userRole);

  // Admins always have full access
  if (isAdmin) {
    return { canUse: true, canEdit: true };
  }

  // Check role restriction from agent JSON config
  if (roleRestriction === 'admin_developer') {
    return { canUse: false, canEdit: false };
  }

  // Determine the effective team set for the agent
  const agentTeams = getAgentTeamIds(binding);

  // No teams assigned = org-wide agent, accessible to all members
  if (agentTeams.length === 0) {
    return { canUse: true, canEdit: false };
  }

  // Team-scoped agent: user must be in at least one assigned team
  const userTeamSet = new Set(userTeamIds);
  const hasTeamAccess = agentTeams.some((id) => userTeamSet.has(id));

  return { canUse: hasTeamAccess, canEdit: false };
}

/**
 * Get the effective set of team IDs for an agent.
 *
 * Merges the legacy `teamId` field with the new `sharedWithTeamIds` array.
 * Returns an empty array for org-wide agents (no team restriction).
 */
export function getAgentTeamIds(binding: AgentBinding | null): string[] {
  if (!binding) return [];

  const teams = new Set<string>();

  if (binding.teamId) {
    teams.add(binding.teamId);
  }

  if (binding.sharedWithTeamIds) {
    for (const id of binding.sharedWithTeamIds) {
      teams.add(id);
    }
  }

  return [...teams];
}
