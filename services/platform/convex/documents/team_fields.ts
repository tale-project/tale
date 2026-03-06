/**
 * Helper to compute legacy teamTags from teamId.
 *
 * Used during the transition period to keep the deprecated teamTags field
 * in sync when writing documents via the new single-team model.
 */

export interface TeamFields {
  teamId?: string;
  teamTags?: string[];
  sharedWithTeamIds?: string[];
}

/**
 * Compute all team fields from a single teamId.
 *
 * - undefined → org-wide (all fields undefined)
 * - 'sales' → { teamId: 'sales', teamTags: ['sales'], sharedWithTeamIds: undefined }
 */
export function teamIdToFields(teamId: string | undefined): TeamFields {
  if (!teamId) {
    return {
      teamId: undefined,
      teamTags: undefined,
      sharedWithTeamIds: undefined,
    };
  }

  return {
    teamId,
    teamTags: [teamId],
    sharedWithTeamIds: undefined,
  };
}
