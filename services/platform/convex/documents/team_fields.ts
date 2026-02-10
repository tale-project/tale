/**
 * Helper to convert teamTags to unified team fields.
 *
 * Used during the transition from teamTags to teamId + sharedWithTeamIds.
 * Ensures both old and new fields are kept in sync when writing documents.
 */

interface UnifiedTeamFields {
  teamId?: string;
  sharedWithTeamIds?: string[];
}

/**
 * Convert teamTags array to unified teamId + sharedWithTeamIds fields.
 *
 * - undefined / [] → { teamId: undefined, sharedWithTeamIds: undefined } (org-wide)
 * - ['sales'] → { teamId: 'sales', sharedWithTeamIds: undefined }
 * - ['sales', 'marketing'] → { teamId: 'sales', sharedWithTeamIds: ['marketing'] }
 */
export function teamTagsToUnifiedFields(
  teamTags: string[] | undefined,
): UnifiedTeamFields {
  if (!teamTags || teamTags.length === 0) {
    return { teamId: undefined, sharedWithTeamIds: undefined };
  }

  return {
    teamId: teamTags[0],
    sharedWithTeamIds: teamTags.length > 1 ? teamTags.slice(1) : undefined,
  };
}
