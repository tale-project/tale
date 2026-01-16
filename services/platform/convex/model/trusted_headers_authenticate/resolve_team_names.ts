/**
 * Business logic for resolving teams from trusted headers.
 *
 * In trusted headers mode, the external IdP is the single source of truth
 * for team membership. We simply pass through the external team data without
 * any database lookup or validation.
 *
 * The external team IDs and names are stored directly in the session/JWT.
 * - Team IDs are used for document team tags filtering
 * - Team names are used for UI display
 */

export interface TeamEntry {
  id: string;
  name: string;
}

export interface ResolveTeamsArgs {
  teams: TeamEntry[];
}

export interface ResolveTeamsResult {
  /** Full team data (id + name) for storage in JWT */
  teams: TeamEntry[];
}

export function resolveTeams(args: ResolveTeamsArgs): ResolveTeamsResult {
  const { teams } = args;

  if (teams.length === 0) {
    return { teams: [] };
  }

  // Pass through external team data directly - no DB lookup needed
  // The external IdP is the single source of truth for team membership
  return { teams };
}
