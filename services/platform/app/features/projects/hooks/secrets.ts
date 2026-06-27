import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

export function useProjectSecrets(projectId: Id<'projects'> | undefined) {
  const { data, isLoading } = useConvexQuery(
    api.projects.secrets.queries.listProjectSecrets,
    projectId ? { projectId } : 'skip',
  );
  return { secrets: data ?? [], isLoading };
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
