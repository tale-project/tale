import type { FunctionReturnType } from 'convex/server';

import { useAction } from 'convex/react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/convex/_generated/api';

// ---------------------------------------------------------------------------
// Action-based hooks (filesystem reads — no reactivity)
// ---------------------------------------------------------------------------

type ListWorkflowsResult = FunctionReturnType<
  typeof api.workflows.file_actions.listWorkflows
>;

type WorkflowFilter = 'installed' | 'templates' | 'all';

export function useListWorkflows(orgSlug: string, filter?: WorkflowFilter) {
  const listWorkflowsFn = useAction(api.workflows.file_actions.listWorkflows);
  const [data, setData] = useState<ListWorkflowsResult | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listWorkflowsFn({ orgSlug, filter });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [listWorkflowsFn, orgSlug, filter]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refetch();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refetch]);

  return { workflows: data, isLoading, error, refetch };
}

type ReadWorkflowResult = FunctionReturnType<
  typeof api.workflows.file_actions.readWorkflow
>;

export function useReadWorkflow(
  orgSlug: string,
  workflowSlug: string | undefined,
) {
  const readWorkflowFn = useAction(api.workflows.file_actions.readWorkflow);
  const [data, setData] = useState<ReadWorkflowResult | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!workflowSlug) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await readWorkflowFn({ orgSlug, workflowSlug });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [readWorkflowFn, orgSlug, workflowSlug]);

  useEffect(() => {
    if (!workflowSlug) {
      setData(undefined);
      setIsLoading(false);
      return;
    }
    void refetch();
  }, [refetch, workflowSlug]);

  return { data, isLoading, error, refetch };
}

type ListHistoryResult = FunctionReturnType<
  typeof api.workflows.file_actions.listHistory
>;

export function useWorkflowHistory(orgSlug: string, workflowSlug: string) {
  const listHistoryFn = useAction(api.workflows.file_actions.listHistory);
  const [data, setData] = useState<ListHistoryResult | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listHistoryFn({ orgSlug, workflowSlug });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [listHistoryFn, orgSlug, workflowSlug]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { history: data, isLoading, error, refetch };
}
