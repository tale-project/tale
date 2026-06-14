/**
 * Helper to compute team storage fields from a list of team IDs.
 *
 * Documents can belong to multiple teams. The schema stores:
 * - teamId: the first team (for single-team consumers)
 * - teamTags: full list of team IDs the document belongs to
 */

export interface TeamFields {
  teamId?: string;
  teamTags?: string[];
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
    };
  }

  return {
    teamId: teamIds[0],
    teamTags: teamIds,
  };
}
