/**
 * Team sync logic for Entra ID SSO auto-provisioning.
 *
 * Fetches user's groups from Microsoft Graph API and syncs them as teams
 * in the local database.
 */

import type { MutationCtx } from '../../_generated/server';
import { components } from '../../_generated/api';

interface EntraGroup {
  id: string;
  displayName: string;
}

interface SyncTeamsFromGroupsArgs {
  ctx: MutationCtx;
  userId: string;
  accessToken: string;
  excludeGroups: string[];
  teamMembershipMode: 'sync' | 'additive';
}

interface SyncTeamsResult {
  teamsCreated: number;
  membershipsAdded: number;
  membershipsRemoved: number;
  errors: string[];
}

export async function syncTeamsFromGroups(
  args: SyncTeamsFromGroupsArgs,
): Promise<SyncTeamsResult> {
  const { ctx, userId, accessToken, excludeGroups, teamMembershipMode } = args;

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

    if (teamMembershipMode === 'sync') {
      const removed = await removeStaleTeamMemberships(
        ctx,
        userId,
        syncedTeamNames,
        organizationId,
      );
      result.membershipsRemoved = removed;
    }
  } catch (error) {
    result.errors.push(
      `Team sync failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return result;
}

async function getOrganizationId(ctx: MutationCtx): Promise<string | null> {
  const orgsResult = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'organization',
    paginationOpts: {
      cursor: null,
      numItems: 2,
    },
    where: [],
  });

  if (!orgsResult || orgsResult.page.length !== 1) {
    console.warn(
      '[SSO] Expected exactly one organization, found:',
      orgsResult?.page.length ?? 0,
    );
    return null;
  }

  return orgsResult.page[0]._id;
}

async function fetchEntraGroups(accessToken: string): Promise<EntraGroup[]> {
  const response = await fetch(
    'https://graph.microsoft.com/v1.0/me/memberOf?$select=id,displayName',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Graph API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();

  return (data.value || [])
    .filter(
      (member: { '@odata.type'?: string }) =>
        member['@odata.type'] === '#microsoft.graph.group',
    )
    .map((group: { id: string; displayName: string }) => ({
      id: group.id,
      displayName: group.displayName,
    }));
}

interface Team {
  _id: string;
  name: string;
  organizationId: string;
}

async function findTeamByName(
  ctx: MutationCtx,
  name: string,
  organizationId: string,
): Promise<Team | null> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'team',
    paginationOpts: {
      cursor: null,
      numItems: 100,
    },
    where: [
      {
        field: 'organizationId',
        value: organizationId,
        operator: 'eq',
      },
    ],
  });

  if (!result || result.page.length === 0) {
    return null;
  }

  const team = result.page.find(
    (t: { name: string }) => t.name.toLowerCase() === name.toLowerCase(),
  );
  return team
    ? { _id: team._id, name: team.name, organizationId: team.organizationId }
    : null;
}

async function createTeam(
  ctx: MutationCtx,
  name: string,
  organizationId: string,
): Promise<Team> {
  const result = await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'team',
      data: {
        name,
        organizationId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
  });

  const teamId = result._id ?? result.id ?? String(result);
  return { _id: teamId, name, organizationId };
}

async function isTeamMember(
  ctx: MutationCtx,
  teamId: string,
  userId: string,
): Promise<boolean> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'teamMember',
    paginationOpts: {
      cursor: null,
      numItems: 1,
    },
    where: [
      {
        field: 'teamId',
        value: teamId,
        operator: 'eq',
      },
      {
        field: 'userId',
        value: userId,
        operator: 'eq',
      },
    ],
  });

  return result && result.page.length > 0;
}

async function addTeamMember(
  ctx: MutationCtx,
  teamId: string,
  userId: string,
): Promise<void> {
  await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'teamMember',
      data: {
        teamId,
        userId,
        createdAt: Date.now(),
      },
    },
  });
}

async function removeStaleTeamMemberships(
  ctx: MutationCtx,
  userId: string,
  currentTeamNames: string[],
  organizationId: string,
): Promise<number> {
  const userMembershipsResult = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'teamMember',
      paginationOpts: {
        cursor: null,
        numItems: 100,
      },
      where: [
        {
          field: 'userId',
          value: userId,
          operator: 'eq',
        },
      ],
    },
  );

  if (!userMembershipsResult || userMembershipsResult.page.length === 0) {
    return 0;
  }

  let removedCount = 0;
  const currentTeamNamesLower = currentTeamNames.map((n) => n.toLowerCase());

  for (const membership of userMembershipsResult.page) {
    const teamResult = await ctx.runQuery(
      components.betterAuth.adapter.findOne,
      {
        model: 'team',
        where: [{ field: '_id', value: membership.teamId, operator: 'eq' }],
      },
    );

    if (!teamResult || teamResult.organizationId !== organizationId) {
      continue;
    }

    if (!currentTeamNamesLower.includes(teamResult.name.toLowerCase())) {
      await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: {
          model: 'teamMember',
          where: [{ field: '_id', value: membership._id, operator: 'eq' }],
        },
      });
      removedCount++;

      const remainingMembers = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'teamMember',
          paginationOpts: { cursor: null, numItems: 1 },
          where: [
            { field: 'teamId', operator: 'eq', value: membership.teamId },
          ],
        },
      );

      if (!remainingMembers || remainingMembers.page.length === 0) {
        await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
          input: {
            model: 'team',
            where: [{ field: '_id', value: membership.teamId, operator: 'eq' }],
          },
        });
      }
    }
  }

  return removedCount;
}

export function mapEntraRoleToPlatformRole(
  entraRoles: string[] | undefined,
): 'admin' | 'member' {
  if (!entraRoles || entraRoles.length === 0) {
    return 'member';
  }

  const normalizedRoles = entraRoles.map((r) => r.toLowerCase());

  if (normalizedRoles.includes('admin')) {
    return 'admin';
  }

  return 'member';
}
