import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useAvailableTools() {
  const tools = useQuery(api.custom_agents.queries.getAvailableTools);

  return {
    tools: tools ?? null,
    isLoading: tools === undefined,
  };
}
