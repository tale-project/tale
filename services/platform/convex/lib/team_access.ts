/**
 * Shared team access helper for single-team model.
 *
 * All team-scoped tables use:
 *   teamId: optional string (undefined/null = org-wide)
 *
 * This helper is used by documents, custom agents, and future team-scoped modules.
 */

interface TeamScopedResource {
  teamId?: string | null;
}

/**
 * Check if a user has access to a team-scoped resource.
 *
 * Access rules:
 * - Resource with no teamId (null/undefined) = org-wide, accessible to all members
 * - Resource with teamId = user must belong to that team
 */
export function hasTeamAccess(
  resource: TeamScopedResource,
  userTeamIds: string[] | Set<string>,
): boolean {
  if (!resource.teamId) return true;

  const teamSet =
    userTeamIds instanceof Set ? userTeamIds : new Set(userTeamIds);

  return teamSet.has(resource.teamId);
}
