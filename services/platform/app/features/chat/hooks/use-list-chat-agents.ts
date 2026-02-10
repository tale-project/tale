import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useTeamFilter } from '@/app/hooks/use-team-filter';

export function useListChatAgents(organizationId: string) {
  const { selectedTeamId } = useTeamFilter();

  return useQuery(
    api.custom_agents.queries.listCustomAgents,
    {
      organizationId,
      filterTeamId: selectedTeamId || undefined,
      filterPublished: true,
    },
  );
}
