import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Id } from '@/convex/_generated/dataModel';
import type { AvailableIntegration } from '@/lib/collections/entities/available-integrations';
import type { AvailableTool } from '@/lib/collections/entities/available-tools';
import type { CustomAgentVersion } from '@/lib/collections/entities/custom-agent-versions';
import type { CustomAgentWebhook } from '@/lib/collections/entities/custom-agent-webhooks';
import type { CustomAgent } from '@/lib/collections/entities/custom-agents';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { api } from '@/convex/_generated/api';

export function useCustomAgents(collection: Collection<CustomAgent, string>) {
  const { selectedTeamId } = useTeamFilter();

  const { data, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ agent: collection })
        .fn.where((row) => {
          if (!selectedTeamId) return true;
          const { agent } = row;
          return (
            agent.teamId === selectedTeamId ||
            (agent.sharedWithTeamIds?.includes(selectedTeamId) ?? false)
          );
        })
        .select(({ agent }) => agent),
    [selectedTeamId],
  );

  return {
    agents: data,
    isLoading,
  };
}

export function useCustomAgentVersions(
  collection: Collection<CustomAgentVersion, string>,
) {
  const { data, isLoading } = useLiveQuery(
    (q) => q.from({ version: collection }).select(({ version }) => version),
    [],
  );

  return {
    versions: data,
    isLoading,
  };
}

export function useCustomAgentWebhooks(
  collection: Collection<CustomAgentWebhook, string>,
) {
  const { data, isLoading } = useLiveQuery(
    (q) => q.from({ webhook: collection }).select(({ webhook }) => webhook),
    [],
  );

  return {
    webhooks: data,
    isLoading,
  };
}

export function useAvailableIntegrations(
  collection: Collection<AvailableIntegration, string>,
) {
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

export function useAvailableTools(
  collection: Collection<AvailableTool, string>,
) {
  const { data, isLoading } = useLiveQuery(
    (q) => q.from({ tool: collection }).select(({ tool }) => tool),
    [],
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

export type { CustomAgentVersion, CustomAgentWebhook };
