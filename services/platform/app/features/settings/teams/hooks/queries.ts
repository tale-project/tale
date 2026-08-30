import { useQuery } from '@tanstack/react-query';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import type { ItemOf } from '@/app/lib/backend/contract';
import { myTeamsQuery, type MyTeamRow } from '@/app/lib/backend/org';

export type Team = MyTeamRow;

export function useApproxTeamCount(organizationId: string) {
  return useConvexQuery('members/queries:approxCountMyTeams', {
    organizationId,
  });
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
  const { data, isLoading } = useConvexQuery(
    'members/queries:listOrgTeams',
    organizationId ? { organizationId } : 'skip',
  );

  return {
    teams: data ?? undefined,
    isLoading,
  };
}

export type TeamMember = ItemOf<'team_members/queries:listByTeam'>;

export function useTeamMembers(teamId: string) {
  const { data, isLoading } = useConvexQuery(
    'team_members/queries:listByTeam',
    { teamId },
  );

  return {
    teamMembers: data,
    isLoading,
  };
}
