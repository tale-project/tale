import { useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useAvailableIntegrations(organizationId: string) {
  const integrations = useQuery(
    api.custom_agents.queries.getAvailableIntegrations,
    { organizationId },
  );

  return {
    integrations: integrations ?? null,
    isLoading: integrations === undefined,
  };
}
