import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { api } from '@/convex/_generated/api';

export type Team = ConvexItemOf<typeof api.members.queries.getMyTeams>;

export function useApproxTeamCount(organizationId: string) {
  return useConvexQuery(api.members.queries.approxCountMyTeams, {
    organizationId,
  });
}

export function useTeams() {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    api.members.queries.getMyTeams,
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
