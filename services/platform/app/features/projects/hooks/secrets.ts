import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendQuery } from '@/app/hooks/use-backend-query';

export function useProjectSecrets(projectId: string | undefined) {
  const { data, isLoading, error, isError } = useBackendQuery(
    'projects/secrets/queries:listProjectSecrets',
    projectId ? { projectId } : 'skip',
  );
  // Surface the query error instead of swallowing it — a non-admin who reaches
  // this query (e.g. via a direct URL) gets `AppError({ code: '...' })`,
  // which the Secrets tab maps to a translated access-denied message rather
  // than the misleading "No secrets yet." empty state.
  return { secrets: data ?? [], isLoading, error, isError };
}

export function useSetProjectSecret() {
  return useBackendAction('projects/secrets/actions:setProjectSecret');
}

export function useSetProjectSecretPair() {
  return useBackendAction('projects/secrets/actions:setProjectSecretPair');
}

export function useDeleteProjectSecret() {
  return useBackendAction('projects/secrets/actions:deleteProjectSecret');
}
