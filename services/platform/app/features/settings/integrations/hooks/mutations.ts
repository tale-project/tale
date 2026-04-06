import { useQueryClient } from '@tanstack/react-query';
import { useAction } from 'convex/react';
import { useCallback } from 'react';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

function useInvalidateIntegrations() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: ['config', 'integrations'] });
}

export function useGenerateUploadUrl() {
  return useConvexMutation(api.files.mutations.generateUploadUrl);
}

export function useUpdateCredentials() {
  const saveFn = useAction(api.integrations.actions.saveCredentials);
  const invalidate = useInvalidateIntegrations();

  const mutateAsync = useCallback(
    async (...args: Parameters<typeof saveFn>) => {
      const result = await saveFn(...args);
      void invalidate();
      return result;
    },
    [saveFn, invalidate],
  );

  return { mutateAsync };
}

export function useDeleteIntegration() {
  const mutation = useConvexMutation(
    api.integrations.credential_mutations.deleteCredentials,
  );
  const invalidate = useInvalidateIntegrations();

  const originalMutateAsync = mutation.mutateAsync;

  const mutateAsync = useCallback(
    async (...args: Parameters<typeof originalMutateAsync>) => {
      const result = await originalMutateAsync(...args);
      void invalidate();
      return result;
    },
    [originalMutateAsync, invalidate],
  );

  return { ...mutation, mutateAsync };
}
