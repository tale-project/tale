import { useQuery } from '@tanstack/react-query';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { myTeamsQuery, type MyTeamRow } from '@/app/lib/backend/org';
import { api } from '@/convex/_generated/api';
import type { ConvexItemOf } from '@/lib/types/convex-helpers';

export type Team = MyTeamRow;

export function useApproxTeamCount(organizationId: string) {
  return useConvexQuery(api.members.queries.approxCountMyTeams, {
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
    api.members.queries.listOrgTeams,
    organizationId ? { organizationId } : 'skip',
  );

  return {
    teams: data ?? undefined,
    isLoading,
  };
}

export type TeamMember = ConvexItemOf<
  typeof api.team_members.queries.listByTeam
>;

export function useTeamMembers(teamId: string) {
  const { data, isLoading } = useConvexQuery(
    api.team_members.queries.listByTeam,
    { teamId },
  );

  return {
    teamMembers: data,
    isLoading,
  };
}
