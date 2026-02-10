/**
 * Shared team access helper for unified team fields.
 *
 * All team-scoped tables use:
 *   teamId: optional string (null = org-wide)
 *   sharedWithTeamIds: optional string[] (additional teams with access)
 *
 * This helper is used by documents, custom agents, and future team-scoped modules.
 */

interface TeamScopedResource {
  teamId?: string | null;
  sharedWithTeamIds?: string[];
}

/**
 * Check if a user has access to a team-scoped resource.
 *
 * Access rules:
 * - Resource with no teamId (null/undefined) = org-wide, accessible to all members
 * - Resource with teamId = user must belong to the primary team or a shared team
 */
export function hasTeamAccess(
  resource: TeamScopedResource,
  userTeamIds: string[] | Set<string>,
): boolean {
  if (!resource.teamId) return true;

  const teamSet =
    userTeamIds instanceof Set ? userTeamIds : new Set(userTeamIds);

  if (teamSet.has(resource.teamId)) return true;

  return resource.sharedWithTeamIds?.some((id) => teamSet.has(id)) ?? false;
}
