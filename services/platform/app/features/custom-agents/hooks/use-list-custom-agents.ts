import { useQuery } from 'convex/react';

import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { api } from '@/convex/_generated/api';

export function useListCustomAgents(organizationId: string) {
  const { selectedTeamId } = useTeamFilter();

  const agents = useQuery(api.custom_agents.queries.listCustomAgents, {
    organizationId,
    filterTeamId: selectedTeamId || undefined,
  });

  return {
    agents: agents ?? null,
    isLoading: agents === undefined,
  };
}
