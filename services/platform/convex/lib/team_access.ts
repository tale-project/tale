/**
 * Shared team access helper for multi-team model.
 *
 * All team-scoped tables use:
 *   teamId: optional string — primary/first team (backward compat)
 *   teamTags: optional string[] — full list of teams
 *
 * This helper is used by documents, custom agents, and future team-scoped modules.
 */

interface TeamScopedResource {
  teamId?: string | null;
  teamTags?: string[];
}

/**
 * Check if a user has access to a team-scoped resource.
 *
 * Access rules:
 * - Resource with no teams (no teamId and no teamTags) = org-wide, accessible to all members
 * - Resource with teams = user must belong to at least one of the resource's teams
 */
export function hasTeamAccess(
  resource: TeamScopedResource,
  userTeamIds: string[] | Set<string>,
): boolean {
  const resourceTeams =
    resource.teamTags ?? (resource.teamId ? [resource.teamId] : []);
  if (resourceTeams.length === 0) return true;

  const teamSet =
    userTeamIds instanceof Set ? userTeamIds : new Set(userTeamIds);

  return resourceTeams.some((id) => teamSet.has(id));
}
