import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import {
  myTeamsQuery,
  teamDirectoryQuery,
  type MyTeamRow,
  type TeamDirectoryEntry,
} from '@/app/lib/backend/org';

export type Team = MyTeamRow;

/**
 * Every team of the organization by id and name, for any member — what an
 * audience badge, a project row, an inbox queue or a skill label resolves a
 * team id through. Not a picker's option list: what a member may ASSIGN is
 * `useOrgTeams()` (their own teams; every team for an admin).
 */
export function useTeamDirectory() {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useQuery({
    ...teamDirectoryQuery(organizationId ?? ''),
    enabled: !!organizationId,
  });
  return {
    teams: data ?? undefined,
    isLoading,
  };
}

/** `useTeamDirectory` as an id → name lookup (empty while loading). The
 * lookup is stable per directory load, so it can sit in a memo's deps. */
export function useTeamNames(): {
  nameOf: (teamId: string) => string | undefined;
  isLoading: boolean;
  teams: TeamDirectoryEntry[] | undefined;
} {
  const { teams, isLoading } = useTeamDirectory();
  const nameOf = useMemo(() => {
    const byId = new Map((teams ?? []).map((team) => [team.id, team.name]));
    return (teamId: string) => byId.get(teamId);
  }, [teams]);
  return { nameOf, isLoading, teams };
}

export function useTeams() {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useQuery({
    ...myTeamsQuery(organizationId ?? ''),
    enabled: !!organizationId,
  });

  return {
    teams: data ?? undefined,
    isLoading,
  };
}

export function useOrgTeams() {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useBackendQuery(
    'members/queries:listOrgTeams',
    organizationId ? { organizationId } : 'skip',
  );

  return {
    teams: data ?? undefined,
    isLoading,
  };
}

/** The delete preview: what deleting `teamId` touches (admin). */
export function useTeamDeletionImpact(teamId: string, enabled: boolean) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useBackendQuery(
    'teams/queries:deletionImpact',
    enabled && organizationId ? { organizationId, teamId } : 'skip',
  );
  return { impact: data ?? undefined, isLoading };
}

export function useTeamMembers(teamId: string) {
  const { data, isLoading } = useBackendQuery(
    'team_members/queries:listByTeam',
    { teamId },
  );

  return {
    teamMembers: data,
    isLoading,
  };
}
