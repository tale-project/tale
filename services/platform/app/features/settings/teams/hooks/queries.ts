import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export type Team = ConvexItemOf<typeof api.members.queries.getMyTeams>;

export function useTeams() {
  const { data, isLoading } = useConvexQuery(api.members.queries.getMyTeams);

  return {
    teams: data ?? null,
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
