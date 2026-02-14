import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexOptimisticMutation } from '@/app/hooks/use-convex-optimistic-mutation';
import { api } from '@/convex/_generated/api';

export function useGenerateUploadUrl() {
  return useConvexMutation(api.files.mutations.generateUploadUrl);
}

export function useUpdateIntegrationIcon() {
  return useConvexMutation(api.integrations.mutations.updateIcon, {
    invalidates: [api.integrations.queries.list],
  });
}

export function useDeleteIntegration() {
  return useConvexOptimisticMutation(
    api.integrations.mutations.deleteIntegration,
    api.integrations.queries.list,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ integrationId }, { remove }) => remove(integrationId),
    },
  );
}
