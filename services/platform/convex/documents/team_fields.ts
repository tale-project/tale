/**
 * Helper to compute team storage fields from a list of team IDs.
 *
 * Documents can belong to multiple teams. The schema stores:
 * - teamId: the first team (for backward compatibility with single-team consumers)
 * - teamTags: full list of team IDs the document belongs to
 * - sharedWithTeamIds: deprecated, always undefined
 */

export interface TeamFields {
  teamId?: string;
  teamTags?: string[];
  sharedWithTeamIds?: string[];
}

/**
 * Compute all team fields from a list of team IDs.
 *
 * - [] or undefined → org-wide (all fields undefined)
 * - ['sales'] → { teamId: 'sales', teamTags: ['sales'] }
 * - ['sales', 'support'] → { teamId: 'sales', teamTags: ['sales', 'support'] }
 */
export function teamIdsToFields(teamIds: string[] | undefined): TeamFields {
  if (!teamIds || teamIds.length === 0) {
    return {
      teamId: undefined,
      teamTags: undefined,
      sharedWithTeamIds: undefined,
    };
  }

  return {
    teamId: teamIds[0],
    teamTags: teamIds,
    sharedWithTeamIds: undefined,
  };
}

/**
 * Compute all team fields from a single teamId.
 * @deprecated Use teamIdsToFields instead.
 */
export function teamIdToFields(teamId: string | undefined): TeamFields {
  return teamIdsToFields(teamId ? [teamId] : undefined);
}
