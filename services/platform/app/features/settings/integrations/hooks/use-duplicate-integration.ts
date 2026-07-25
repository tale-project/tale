import { useCallback } from 'react';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

import { useInvalidateIntegrations } from './mutations';

/**
 * Duplicate an integration under a new, unique slug — clones its config +
 * inactive credential and rebinds any bundled sync automation to the new slug —
 * then refresh the integrations list so the new instance's card appears.
 */
export function useDuplicateIntegration() {
  const { mutateAsync: duplicate } = useConvexAction(
    api.integrations.file_actions.duplicateIntegration,
  );
  const invalidate = useInvalidateIntegrations();

  const mutateAsync = useCallback(
    async (...args: Parameters<typeof duplicate>) => {
      const result = await duplicate(...args);
      void invalidate();
      return result;
    },
    [duplicate, invalidate],
  );

  return { mutateAsync };
}
