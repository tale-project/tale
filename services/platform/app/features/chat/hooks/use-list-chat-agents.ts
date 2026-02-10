import { useQuery } from 'convex/react';

import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { api } from '@/convex/_generated/api';

export function useListChatAgents(organizationId: string) {
  const { selectedTeamId } = useTeamFilter();

  return useQuery(api.custom_agents.queries.listCustomAgents, {
    organizationId,
    filterTeamId: selectedTeamId || undefined,
    filterPublished: true,
  });
}
