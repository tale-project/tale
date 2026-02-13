import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useGenerateUploadUrl() {
  return useConvexMutation(api.files.mutations.generateUploadUrl);
}

export function useUpdateIntegrationIcon() {
  return useConvexMutation(api.integrations.mutations.updateIcon);
}

export function useDeleteIntegration() {
  const { mutateAsync } = useConvexMutation(
    api.integrations.mutations.deleteIntegration,
  );
  return mutateAsync;
}
