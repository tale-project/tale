import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';

export function useProjectSecrets(projectId: string | undefined) {
  const { data, isLoading, error, isError } = useConvexQuery(
    'projects/secrets/queries:listProjectSecrets',
    projectId ? { projectId } : 'skip',
  );
  // Surface the query error instead of swallowing it — a non-admin who reaches
  // this query (e.g. via a direct URL) gets `ConvexError({ code: '...' })`,
  // which the Secrets tab maps to a translated access-denied message rather
  // than the misleading "No secrets yet." empty state.
  return { secrets: data ?? [], isLoading, error, isError };
}

export function useSetProjectSecret() {
  return useConvexAction('projects/secrets/actions:setProjectSecret');
}

export function useSetProjectSecretPair() {
  return useConvexAction('projects/secrets/actions:setProjectSecretPair');
}

export function useDeleteProjectSecret() {
  return useConvexAction('projects/secrets/actions:deleteProjectSecret');
}
