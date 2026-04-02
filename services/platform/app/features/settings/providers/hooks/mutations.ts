import { useQueryClient } from '@tanstack/react-query';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

function useInvalidateProviders() {
  const queryClient = useQueryClient();
  return (orgSlug: string) =>
    queryClient.invalidateQueries({
      queryKey: ['config', 'providers', orgSlug],
    });
}

export function useSaveProvider() {
  const invalidate = useInvalidateProviders();
  return useConvexAction(api.providers.file_actions.saveProvider, {
    onSuccess: (_data, variables) => invalidate(variables.orgSlug),
  });
}

export function useDeleteProvider() {
  const invalidate = useInvalidateProviders();
  return useConvexAction(api.providers.file_actions.deleteProvider, {
    onSuccess: (_data, variables) => invalidate(variables.orgSlug),
  });
}

export function useSaveProviderSecret() {
  const invalidate = useInvalidateProviders();
  return useConvexAction(api.providers.file_actions.saveProviderSecret, {
    onSuccess: (_data, variables) => invalidate(variables.orgSlug),
  });
}
