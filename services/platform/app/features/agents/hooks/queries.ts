import type { FunctionReturnType } from 'convex/server';

import { useAction } from 'convex/react';
import { useCallback, useEffect, useState } from 'react';

import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

// ---------------------------------------------------------------------------
// Action-based hooks (filesystem reads — no reactivity)
// ---------------------------------------------------------------------------

type ListAgentsResult = FunctionReturnType<
  typeof api.agents.file_actions.listAgents
>;

export function useListAgents(orgSlug: string) {
  const listAgentsFn = useAction(api.agents.file_actions.listAgents);
  const [data, setData] = useState<ListAgentsResult | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listAgentsFn({ orgSlug });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [listAgentsFn, orgSlug]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { agents: data, isLoading, error, refetch };
}

type ReadAgentResult = FunctionReturnType<
  typeof api.agents.file_actions.readAgent
>;

export function useReadAgent(orgSlug: string, agentName: string) {
  const readAgentFn = useAction(api.agents.file_actions.readAgent);
  const [data, setData] = useState<ReadAgentResult | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await readAgentFn({ orgSlug, agentName });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [readAgentFn, orgSlug, agentName]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}

type ListHistoryResult = FunctionReturnType<
  typeof api.agents.file_actions.listHistory
>;

export function useAgentHistory(orgSlug: string, agentName: string) {
  const listHistoryFn = useAction(api.agents.file_actions.listHistory);
  const [data, setData] = useState<ListHistoryResult | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listHistoryFn({ orgSlug, agentName });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [listHistoryFn, orgSlug, agentName]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { history: data, isLoading, error, refetch };
}

// ---------------------------------------------------------------------------
// Query-based hooks (DB reads — reactive)
// ---------------------------------------------------------------------------

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
  const getWorkflowsFn = useAction(
    api.workflows.file_actions.getAvailableWorkflows,
  );
  const [workflows, setWorkflows] = useState<AvailableWorkflow[] | undefined>(
    undefined,
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void getWorkflowsFn({ organizationId }).then((result) => {
      if (!cancelled) {
        setWorkflows(result);
        setIsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [getWorkflowsFn, organizationId]);

  return {
    workflows,
    isLoading,
  };
}

export function useModelPresets() {
  return useConvexQuery(api.agents.queries.getModelPresets);
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
