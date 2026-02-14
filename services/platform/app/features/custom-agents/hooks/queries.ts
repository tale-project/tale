import { useMemo } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { api } from '@/convex/_generated/api';

export type CustomAgent = ConvexItemOf<
  typeof api.custom_agents.queries.listCustomAgents
>;

export function useCustomAgents(organizationId: string) {
  const { selectedTeamId } = useTeamFilter();

  const { data, isLoading } = useConvexQuery(
    api.custom_agents.queries.listCustomAgents,
    { organizationId },
  );

  const agents = useMemo(() => {
    if (!data) return undefined;
    return data.filter((agent) => {
      if (!selectedTeamId) return true;
      return (
        agent.teamId === selectedTeamId ||
        (agent.sharedWithTeamIds?.includes(selectedTeamId) ?? false)
      );
    });
  }, [data, selectedTeamId]);

  return {
    agents,
    isLoading,
  };
}

export type CustomAgentVersion = ConvexItemOf<
  typeof api.custom_agents.queries.getCustomAgentVersions
>;

export function useCustomAgentVersions(customAgentId: string) {
  const { data, isLoading } = useConvexQuery(
    api.custom_agents.queries.getCustomAgentVersions,
    { customAgentId },
  );

  return {
    versions: data,
    isLoading,
  };
}

export type CustomAgentWebhook = ConvexItemOf<
  typeof api.custom_agents.webhooks.queries.getWebhooks
>;

export function useCustomAgentWebhooks(customAgentId: string) {
  const { data, isLoading } = useConvexQuery(
    api.custom_agents.webhooks.queries.getWebhooks,
    { customAgentId },
  );

  return {
    webhooks: data,
    isLoading,
  };
}

export type AvailableIntegration = ConvexItemOf<
  typeof api.custom_agents.queries.getAvailableIntegrations
>;

export function useAvailableIntegrations(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.custom_agents.queries.getAvailableIntegrations,
    { organizationId },
  );

  return {
    integrations: data,
    isLoading,
  };
}

export type AvailableTool = ConvexItemOf<
  typeof api.custom_agents.queries.getAvailableTools
>;

export function useAvailableTools() {
  const { data, isLoading } = useConvexQuery(
    api.custom_agents.queries.getAvailableTools,
  );

  return {
    tools: data,
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
