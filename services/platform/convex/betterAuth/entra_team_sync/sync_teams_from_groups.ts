import type { SyncTeamsFromGroupsArgs, SyncTeamsResult } from './types';
import { getOrganizationId } from './get_organization_id';
import { fetchEntraGroups } from './fetch_entra_groups';
import { findTeamByName } from './find_team_by_name';
import { createTeam } from './create_team';
import { isTeamMember } from './is_team_member';
import { addTeamMember } from './add_team_member';
import { removeStaleTeamMemberships } from './remove_stale_team_memberships';

export async function syncTeamsFromGroups(
  args: SyncTeamsFromGroupsArgs,
): Promise<SyncTeamsResult> {
  const { ctx, userId, accessToken, excludeGroups } = args;

  const result: SyncTeamsResult = {
    teamsCreated: 0,
    membershipsAdded: 0,
    membershipsRemoved: 0,
    errors: [],
  };

  try {
    const organizationId = await getOrganizationId(ctx);
    if (!organizationId) {
      result.errors.push('No organization found, skipping team sync');
      return result;
    }

    const groups = await fetchEntraGroups(accessToken);

    const excludeGroupsLower = excludeGroups.map((g) => g.toLowerCase().trim());
    const syncableGroups = groups.filter(
      (g) => !excludeGroupsLower.includes(g.displayName.toLowerCase()),
    );

    const syncedTeamNames: string[] = [];

    for (const group of syncableGroups) {
      try {
        const teamName = group.displayName;
        syncedTeamNames.push(teamName);

        let team = await findTeamByName(ctx, teamName, organizationId);
        if (!team) {
          team = await createTeam(ctx, teamName, organizationId);
          result.teamsCreated++;
        }

        const isMember = await isTeamMember(ctx, team._id, userId);
        if (!isMember) {
          await addTeamMember(ctx, team._id, userId);
          result.membershipsAdded++;
        }
      } catch (error) {
        result.errors.push(
          `Failed to sync group ${group.displayName}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const removed = await removeStaleTeamMemberships(
      ctx,
      userId,
      syncedTeamNames,
      organizationId,
    );
    result.membershipsRemoved = removed;
  } catch (error) {
    result.errors.push(
      `Team sync failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return result;
}
