import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { ConvexItemOf } from '@/lib/types/convex-helpers';

// ---------------------------------------------------------------------------
// Action-based hooks (filesystem reads — cached via TanStack Query,
// invalidated by SSE file events and mutation onSuccess)
// ---------------------------------------------------------------------------

export function useListAgents(organizationId: string) {
  const { data, isLoading, error, refetch } = useActionQuery(
    configKeys.list('agents', organizationId),
    api.agents.file_actions.listAgents,
    { organizationId },
    // Never fire with an empty org id: callers fall back to `''` while the org
    // context is still resolving (e.g. `useChatAgents(organizationId ?? '')`),
    // and `listAgents('')` makes the Better Auth adapter `db.get('')`, which
    // throws "Invalid ID length 0" server-side.
    { enabled: !!organizationId },
  );
  return { agents: data, isLoading, error, refetch };
}

/**
 * Live install-state for the agent catalog (which agents are installed/enabled
 * for the org, their provenance, and disabled reason). Reactive Convex query —
 * install/enable/disable mutations refresh it automatically.
 */
export function useAgentInstallations(organizationId: string) {
  return useConvexQuery(
    api.agents.installations.listInstallStates,
    { organizationId },
    { enabled: !!organizationId },
  );
}

export function useReadAgent(organizationId: string, agentName: string) {
  return useActionQuery(
    configKeys.detail('agents', organizationId, agentName),
    api.agents.file_actions.readAgent,
    { organizationId, agentName },
  );
}

export function useAgentHistory(organizationId: string, agentName: string) {
  const { data, isLoading, error, refetch } = useActionQuery(
    configKeys.history('agents', organizationId, agentName),
    api.agents.file_actions.listHistory,
    { organizationId, agentName },
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
