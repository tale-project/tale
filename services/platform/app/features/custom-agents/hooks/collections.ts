'use client';

import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { CustomAgentVersion } from '@/lib/collections/entities/custom-agent-versions';
import type { CustomAgentWebhook } from '@/lib/collections/entities/custom-agent-webhooks';
import type { CustomAgent } from '@/lib/collections/entities/custom-agents';

import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { createCustomAgentVersionsCollection } from '@/lib/collections/entities/custom-agent-versions';
import { createCustomAgentWebhooksCollection } from '@/lib/collections/entities/custom-agent-webhooks';
import { createCustomAgentsCollection } from '@/lib/collections/entities/custom-agents';
import { useCollection } from '@/lib/collections/use-collection';

export function useCustomAgentCollection(organizationId: string) {
  return useCollection(
    'custom-agents',
    createCustomAgentsCollection,
    organizationId,
  );
}

export function useCustomAgentVersionCollection(
  customAgentId: string | undefined,
) {
  return useCollection(
    'custom-agent-versions',
    createCustomAgentVersionsCollection,
    customAgentId ?? '',
  );
}

export function useCustomAgentWebhookCollection(
  customAgentId: string | undefined,
) {
  return useCollection(
    'custom-agent-webhooks',
    createCustomAgentWebhooksCollection,
    customAgentId ?? '',
  );
}

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

export type { CustomAgentVersion };

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

export type { CustomAgentWebhook };
