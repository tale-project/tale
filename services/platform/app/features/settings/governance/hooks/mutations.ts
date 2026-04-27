import { useQueryClient } from '@tanstack/react-query';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useUpsertGovernancePolicy() {
  return useConvexMutation(api.governance.mutations.upsertPolicy);
}

export function useSaveModerationSecret() {
  const queryClient = useQueryClient();
  return useConvexAction(
    api.governance.moderation_provider.secrets.saveModerationSecret,
    {
      onSuccess: (_data, variables) => {
        // Invalidate the mask query so the UI shows the updated fingerprint.
        void queryClient.invalidateQueries({
          queryKey: ['moderation-secret-status', variables.organizationId],
        });
      },
    },
  );
}

export function useTestModerationProvider() {
  return useConvexAction(
    api.governance.moderation_provider.test_action.testModerationProvider,
  );
}
