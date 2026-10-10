import { useCallback } from 'react';

import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { readStateOf } from '@/app/lib/backend/read-state';

export function useProjectSecrets(projectId: string | undefined) {
  const query = useBackendQuery(
    'projects/secrets/queries:listProjectSecrets',
    projectId ? { projectId } : 'skip',
  );
  const { data, isLoading, error, isError, refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  // Surface the query error instead of swallowing it — a non-admin who reaches
  // this query (e.g. via a direct URL) gets `AppError({ code: '...' })`,
  // which the Secrets tab maps to a translated access-denied message rather
  // than the misleading "No secrets yet." empty state. Any other failure is
  // the tab's to name and retry (`readStateOf`): `secrets` is empty then
  // because nothing is known, not because nothing is stored (#3887).
  return {
    secrets: data ?? [],
    isLoading,
    error,
    isError,
    ...readStateOf(query),
    retry,
  };
}

// The Environment tab's editor reports a failed write in its own toast;
// the hook's default toast would report the same failure a second time.
export function useSetProjectSecret() {
  return useBackendAction('projects/secrets/actions:setProjectSecret', {
    errorToast: false,
  });
}

export function useDeleteProjectSecret() {
  return useBackendAction('projects/secrets/actions:deleteProjectSecret', {
    errorToast: false,
  });
}
