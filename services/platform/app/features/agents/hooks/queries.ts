import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

// ---------------------------------------------------------------------------
// Action-based hooks (filesystem reads — cached via TanStack Query,
// invalidated by SSE file events and mutation onSuccess)
// ---------------------------------------------------------------------------

export function useListAgents(orgSlug: string) {
  const { data, isLoading, error, refetch } = useActionQuery(
    configKeys.list('agents', orgSlug),
    api.agents.file_actions.listAgents,
    { orgSlug },
  );
  return { agents: data, isLoading, error, refetch };
}

export function useReadAgent(orgSlug: string, agentName: string) {
  return useActionQuery(
    configKeys.detail('agents', orgSlug, agentName),
    api.agents.file_actions.readAgent,
    { orgSlug, agentName },
  );
}

export function useAgentHistory(orgSlug: string, agentName: string) {
  const { data, isLoading, error, refetch } = useActionQuery(
    configKeys.history('agents', orgSlug, agentName),
    api.agents.file_actions.listHistory,
    { orgSlug, agentName },
  );
  return { history: data, isLoading, error, refetch };
}

// ---------------------------------------------------------------------------
// Query-based hooks (DB reads — reactive)
// ---------------------------------------------------------------------------

export function useHasAgentsByTeam(teamId: string) {
  return useConvexQuery(api.agents.queries.hasBindingsByTeam, { teamId });
}

export function useAgentBinding(organizationId: string, agentSlug: string) {
  return useConvexQuery(api.agents.queries.getBindingByAgent, {
    organizationId,
    agentSlug,
  });
}

export type AvailableTool = ConvexItemOf<
  typeof api.agents.queries.getAvailableTools
>;

export function useAvailableTools() {
  const { data, isLoading } = useConvexQuery(
    api.agents.queries.getAvailableTools,
  );

  return {
    tools: data,
    isLoading,
  };
}

export type AvailableIntegration = ConvexItemOf<
  typeof api.agents.queries.getAvailableIntegrations
>;

export function useAvailableIntegrations(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.agents.queries.getAvailableIntegrations,
    { organizationId },
  );

  return {
    integrations: data,
    isLoading,
  };
}

export type AvailableWorkflow = {
  id: string;
  name: string;
  description?: string;
};

export function useAvailableWorkflows(organizationId: string) {
  const { data, isLoading } = useActionQuery(
    ['config', 'workflows', '_available', organizationId],
    api.workflows.file_actions.getAvailableWorkflows,
    { organizationId },
  );

  return {
    workflows: data,
    isLoading,
  };
}

export type AgentWebhook = ConvexItemOf<
  typeof api.agents.webhooks.queries.getWebhooks
>;

export function useAgentWebhooks(organizationId: string, agentSlug: string) {
  const { data, isLoading } = useConvexQuery(
    api.agents.webhooks.queries.getWebhooks,
    { organizationId, agentSlug },
  );

  return {
    webhooks: data,
    isLoading,
  };
}
