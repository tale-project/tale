import { useQuery } from '@tanstack/react-query';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { myTeamsQuery, type MyTeamRow } from '@/app/lib/backend/org';

export type Team = MyTeamRow;

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
