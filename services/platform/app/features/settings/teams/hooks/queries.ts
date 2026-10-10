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
import { type ReadState, readStateOf } from '@/app/lib/backend/read-state';

export type Team = MyTeamRow;

/**
 * Every team of the organization by id and name, for any member — what an
 * audience badge, a project row, an inbox queue or a skill label resolves a
 * team id through. Not a picker's option list: what a member may ASSIGN is
 * `useOrgTeams()` (their own teams; every team for an admin).
 */
export function useTeamDirectory() {
  const organizationId = useOrganizationId();
  const query = useQuery({
    ...teamDirectoryQuery(organizationId ?? ''),
    enabled: !!organizationId,
  });
  const { refetch } = query;
  return {
    teams: query.data ?? undefined,
    isLoading: query.isLoading,
    ...readStateOf(query),
    retry: () => void refetch(),
  };
}

/** `useTeamDirectory` as an id → name lookup (empty while loading). The
 * lookup is stable per directory load, so it can sit in a memo's deps. A
 * name it has not read — still loading, or the read failed (`readStateOf`) —
 * is not an unknown team: only an answered directory can say that. */
export function useTeamNames(): {
  nameOf: (teamId: string) => string | undefined;
  isLoading: boolean;
  teams: TeamDirectoryEntry[] | undefined;
  retry: () => void;
} & ReadState {
  const { teams, isLoading, ...read } = useTeamDirectory();
  const nameOf = useMemo(() => {
    const byId = new Map((teams ?? []).map((team) => [team.id, team.name]));
    return (teamId: string) => byId.get(teamId);
  }, [teams]);
  return { nameOf, isLoading, teams, ...read };
}

/**
 * The signed-in member's own teams, with how the read stands
 * (`readStateOf`): a failed read is the caller's to name and retry, never a
 * membership of no teams (#3847).
 */
export function useTeams() {
  const organizationId = useOrganizationId();
  const query = useQuery({
    ...myTeamsQuery(organizationId ?? ''),
    enabled: !!organizationId,
  });
  const { refetch } = query;

  return {
    teams: query.data ?? undefined,
    isLoading: query.isLoading,
    ...readStateOf(query),
    retry: () => void refetch(),
  };
}

/**
 * The teams the signed-in member may ASSIGN — their own, every team for an
 * admin — with how the read stands (`readStateOf`): a failed read is the
 * caller's to name and retry, never an organization without teams (#3766).
 */
export function useOrgTeams() {
  const organizationId = useOrganizationId();
  const query = useBackendQuery(
    'members/queries:listOrgTeams',
    organizationId ? { organizationId } : 'skip',
  );
  const { refetch } = query;

  return {
    teams: query.data ?? undefined,
    isLoading: query.isLoading,
    ...readStateOf(query),
    retry: () => void refetch(),
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
