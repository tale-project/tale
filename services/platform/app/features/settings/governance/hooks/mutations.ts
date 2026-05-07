import { useQueryClient } from '@tanstack/react-query';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useUpsertGovernancePolicy() {
  return useConvexMutation(api.governance.mutations.upsertPolicy);
}

/**
 * Retention is the one policy type that can't go through the generic
 * `upsertPolicy` mutation: bounds validation needs to read the per-org
 * file at `$TALE_CONFIG_DIR/retention/{orgSlug}.json`, which only the
 * Node-side action layer can do. The V8 action wrapper validates and
 * then calls an internal mutation for the actual write.
 */
export function useUpsertRetentionPolicy() {
  return useConvexAction(
    api.governance.retention_actions.upsertRetentionPolicyAction,
  );
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
