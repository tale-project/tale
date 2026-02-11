import { useLiveQuery } from '@tanstack/react-db';

import type { Id } from '@/convex/_generated/dataModel';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { createAvailableIntegrationsCollection } from '@/lib/collections/entities/available-integrations';
import { useCollection } from '@/lib/collections/use-collection';

export function useAvailableIntegrations(organizationId: string) {
  const collection = useCollection(
    'available-integrations',
    createAvailableIntegrationsCollection,
    organizationId,
  );

  const { data, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ integration: collection })
        .select(({ integration }) => integration),
    [],
  );

  return {
    integrations: data,
    isLoading,
  };
}

export function useAvailableTools() {
  const { data, isLoading } = useConvexQuery(
    api.custom_agents.queries.getAvailableTools,
  );

  return {
    tools: data ?? null,
    isLoading,
  };
}

export function useCustomAgentByVersion(
  customAgentId: Id<'customAgents'>,
  versionNumber?: number,
) {
  return useConvexQuery(api.custom_agents.queries.getCustomAgentByVersion, {
    customAgentId,
    versionNumber,
  });
}

export function useModelPresets() {
  return useConvexQuery(api.custom_agents.queries.getModelPresets);
}
