import { useQueryClient } from '@tanstack/react-query';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';

/**
 * Save a governance policy to its per-org JSON file (the source of truth),
 * which re-syncs the `governanceCache` mirror that `getPolicy` reads. This is
 * a Convex action (filesystem write), so there is no optimistic patch — the
 * reactive `getPolicy` query updates once the write + cache sync complete.
 * Every editor toasts its own failure, so no generic error toast here.
 *
 * Refuses `retention_policy` and `dsar_governance` — those route through
 * `useUpsertRetentionPolicy` / `useProposeDsarPolicy` (bounds / loosen-grace).
 */
export function useUpsertGovernancePolicy() {
  return useConvexAction('governance/file_actions:saveGovernancePolicy');
}

export function useProposeDsarPolicy() {
  // Files are the source of truth, so this is an action (filesystem write).
  // The DSAR editor toasts its own failure message.
  return useConvexAction('governance/dsar_policy:proposeDsarPolicy');
}

export function useCancelPendingDsarPolicyChange() {
  // The DSAR editor toasts its own failure message — opt out of the default.
  return useConvexMutation(
    'governance/dsar_policy:cancelPendingDsarPolicyChange',
    { errorToast: false },
  );
}

/**
 * Retention is the one policy type that can't go through the generic
 * `upsertPolicy` mutation: bounds validation needs to read the per-org
 * file at `$TALE_CONFIG_DIR/<orgSlug>/retention.json`, which only the
 * Node-side action layer can do. The V8 action wrapper validates and
 * then calls an internal mutation for the actual write.
 */
export function useUpsertRetentionPolicy() {
  return useConvexAction(
    'governance/retention_actions:upsertRetentionPolicyAction',
  );
}

export function useSaveModerationSecret() {
  const queryClient = useQueryClient();
  return useConvexAction(
    'governance/moderation_provider/secrets:saveModerationSecret',
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
    'governance/moderation_provider/test_action:testModerationProvider',
  );
}

/**
 * Admin accepts the operator's proposed bound changes. On success,
 * invalidates the proposal query so the banner clears immediately.
 */
export function useApplyBoundsProposal() {
  const queryClient = useQueryClient();
  return useConvexAction(
    'governance/retention_bounds_proposal:applyBoundsProposal',
    {
      onSuccess: (_data, variables) => {
        void queryClient.invalidateQueries({
          queryKey: ['retention-bounds-proposal', variables.organizationId],
        });
      },
    },
  );
}

/**
 * Admin refuses the operator's proposed bound changes. Records the
 * rejected hash; banner stays hidden until operator's effective hash
 * diverges from BOTH applied and rejected. Same invalidation pattern.
 */
export function useRejectBoundsProposal() {
  const queryClient = useQueryClient();
  return useConvexAction(
    'governance/retention_bounds_proposal:rejectBoundsProposal',
    {
      onSuccess: (_data, variables) => {
        void queryClient.invalidateQueries({
          queryKey: ['retention-bounds-proposal', variables.organizationId],
        });
      },
    },
  );
}

export function usePlaceLegalHold() {
  return useConvexMutation('governance/legal_hold:placeLegalHold');
}

export function useRequestLegalHoldRelease() {
  return useConvexMutation('governance/legal_hold:requestLegalHoldRelease');
}

export function useApproveLegalHoldRelease() {
  return useConvexMutation('governance/legal_hold:approveLegalHoldRelease');
}

export function useRejectLegalHoldRelease() {
  return useConvexMutation('governance/legal_hold:rejectLegalHoldRelease');
}

export function useUpsertLegalMatter() {
  return useConvexMutation('governance/legal_hold:upsertLegalMatter');
}

export function useCloseLegalMatter() {
  return useConvexMutation('governance/legal_hold:closeLegalMatter');
}

export function useRestoreSoftDeletedRow() {
  const queryClient = useQueryClient();
  return useConvexMutation('governance/restore:restoreSoftDeletedRow', {
    onSuccess: () => {
      // `convexQuery` produces keys of shape
      //   ['convexQuery', '<module>:<query>', args]
      // so the function name lives at index 1, not 0. Pre-fix this
      // predicate matched nothing (queryKey[0] is always 'convexQuery')
      // and the cache was never invalidated post-restore. The Convex
      // subscription naturally refreshes single-page views, but
      // multi-page accumulators kept the stale entries. Round-2 review
      // F.5.
      void queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          typeof q.queryKey[1] === 'string' &&
          q.queryKey[1].includes('listTrashedRows'),
      });
    },
  });
}
