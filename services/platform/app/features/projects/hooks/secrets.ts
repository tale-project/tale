import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

export function useProjectSecrets(projectId: Id<'projects'> | undefined) {
  const { data, isLoading, error, isError } = useConvexQuery(
    api.projects.secrets.queries.listProjectSecrets,
    projectId ? { projectId } : 'skip',
  );
  // Surface the query error instead of swallowing it — a non-admin who reaches
  // this query (e.g. via a direct URL) gets `ConvexError({ code: '...' })`,
  // which the Secrets tab maps to a translated access-denied message rather
  // than the misleading "No secrets yet." empty state.
  return { secrets: data ?? [], isLoading, error, isError };
}

export function useSetProjectSecret() {
  return useConvexAction(api.projects.secrets.actions.setProjectSecret);
}

export function useSetProjectSecretPair() {
  return useConvexAction(api.projects.secrets.actions.setProjectSecretPair);
}

export function useDeleteProjectSecret() {
  return useConvexAction(api.projects.secrets.actions.deleteProjectSecret);
}
