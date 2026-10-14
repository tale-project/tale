import type { ProjectDispatch } from '@tale/shared/schemas/project-dispatch';
import { useCallback } from 'react';

import { useReactMutation } from '@/app/hooks/use-react-mutation';
import { useReactQuery } from '@/app/hooks/use-react-query';
import { useReactQueryClient } from '@/app/hooks/use-react-query-client';
import {
  projectDispatchConfigurationQuery,
  projectDispatchKey,
  projectDispatchStatusQuery,
  requestDispatchPass,
  saveProjectDispatch,
  setDispatchGate,
} from '@/app/lib/backend/project-dispatch';
import { readStateOf } from '@/app/lib/backend/read-state';

/**
 * The project's Dispatch page reads and writes. The writes raise no toast
 * of their own: each caller reports its failure once — the editor through
 * the save toast of its form, the page's buttons in their own toast — and
 * a write that landed refreshes every read of the dispatch.
 */

/** A pass runs as a job a moment after it is asked for: the readback is read
 * again once more after this long, so the pass shows without the poll. */
const PASS_SETTLE_MS = 4_000;

/** What the project's dispatch does, polled while it is shown. A read that
 * failed is the page's to name and retry (`readStateOf`). */
export function useProjectDispatch(organizationId: string, projectId: string) {
  const query = useReactQuery(
    projectDispatchStatusQuery(organizationId, projectId),
  );
  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  return {
    status: query.data,
    isLoading: query.isLoading,
    error: query.error,
    ...readStateOf(query),
    retry,
  };
}

/** The document the editor starts from, read while the editor is open. */
export function useProjectDispatchConfiguration(
  organizationId: string,
  projectId: string,
  enabled: boolean,
) {
  return useReactQuery({
    ...projectDispatchConfigurationQuery(organizationId, projectId),
    enabled,
  });
}

function useRefreshDispatch(organizationId: string, projectId: string) {
  const queryClient = useReactQueryClient();
  return useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: projectDispatchKey(organizationId, projectId),
      }),
    [queryClient, organizationId, projectId],
  );
}

/** Save the dispatch over the version the editor started from. */
export function useSaveProjectDispatch(
  organizationId: string,
  projectId: string,
) {
  const refresh = useRefreshDispatch(organizationId, projectId);
  return useReactMutation({
    mutationFn: (args: {
      dispatch: ProjectDispatch;
      expectedHash: string | null;
    }) => saveProjectDispatch(organizationId, projectId, args),
    // Returned, so the editor closes on a page that already shows the save.
    onSuccess: () => refresh(),
  });
}

/** Ask for a pass now. */
export function useRequestDispatchPass(
  organizationId: string,
  projectId: string,
) {
  const refresh = useRefreshDispatch(organizationId, projectId);
  return useReactMutation({
    mutationFn: () => requestDispatchPass(organizationId, projectId),
    onSuccess: () => {
      setTimeout(() => {
        void refresh();
      }, PASS_SETTLE_MS);
      return refresh();
    },
  });
}

/** Hold or open one of the dispatch's gates. */
export function useSetDispatchGate(organizationId: string, projectId: string) {
  const refresh = useRefreshDispatch(organizationId, projectId);
  return useReactMutation({
    mutationFn: (args: { key: string; state: 'hold' | 'open' }) =>
      setDispatchGate(organizationId, projectId, args),
    onSuccess: () => refresh(),
  });
}
