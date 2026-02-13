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
        .select(({ agent }) => ({
          _id: agent._id,
          _creationTime: agent._creationTime,
          organizationId: agent.organizationId,
          name: agent.name,
          displayName: agent.displayName,
          description: agent.description,
          avatarUrl: agent.avatarUrl,
          systemInstructions: agent.systemInstructions,
          toolNames: agent.toolNames,
          integrationBindings: agent.integrationBindings,
          modelPreset: agent.modelPreset,
          knowledgeEnabled: agent.knowledgeEnabled,
          includeOrgKnowledge: agent.includeOrgKnowledge,
          knowledgeTopK: agent.knowledgeTopK,
          toneOfVoiceId: agent.toneOfVoiceId,
          filePreprocessingEnabled: agent.filePreprocessingEnabled,
          teamId: agent.teamId,
          sharedWithTeamIds: agent.sharedWithTeamIds,
          createdBy: agent.createdBy,
          isActive: agent.isActive,
          versionNumber: agent.versionNumber,
          status: agent.status,
          rootVersionId: agent.rootVersionId,
          parentVersionId: agent.parentVersionId,
          publishedAt: agent.publishedAt,
          publishedBy: agent.publishedBy,
          changeLog: agent.changeLog,
        })),
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
  const { data, isLoading } = useLiveQuery(() => collection);

  return {
    versions: data,
    isLoading,
  };
}

export function useCustomAgentWebhooks(
  collection: Collection<CustomAgentWebhook, string>,
) {
  const { data, isLoading } = useLiveQuery(() => collection);

  return {
    webhooks: data,
    isLoading,
  };
}

export function useAvailableIntegrations(
  collection: Collection<AvailableIntegration, string>,
) {
  const { data, isLoading } = useLiveQuery(() => collection);

  return {
    integrations: data ?? null,
    isLoading,
  };
}

export function useAvailableTools(
  collection: Collection<AvailableTool, string>,
) {
  const { data, isLoading } = useLiveQuery(() => collection);

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
