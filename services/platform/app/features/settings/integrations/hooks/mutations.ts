import { useAction } from 'convex/react';
import { useCallback } from 'react';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useGenerateUploadUrl() {
  return useConvexMutation(api.files.mutations.generateUploadUrl);
}

export function useUpdateCredentials() {
  const saveFn = useAction(api.integrations.actions.saveCredentials);

  const mutateAsync = useCallback(
    async (...args: Parameters<typeof saveFn>) => {
      const result = await saveFn(...args);
      window.dispatchEvent(new Event('integration-updated'));
      return result;
    },
    [saveFn],
  );

  return { mutateAsync };
}

export function useDeleteIntegration() {
  const mutation = useConvexMutation(
    api.integrations.credential_mutations.deleteCredentials,
  );

  const originalMutateAsync = mutation.mutateAsync;

  const mutateAsync = useCallback(
    async (...args: Parameters<typeof originalMutateAsync>) => {
      const result = await originalMutateAsync(...args);
      window.dispatchEvent(new Event('integration-updated'));
      return result;
    },
    [originalMutateAsync],
  );

  return { ...mutation, mutateAsync };
}
