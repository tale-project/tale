import { updateDocumentQuery } from '@/app/hooks/optimistic-updates';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useUpsertMyPreferences() {
  return useConvexMutation(api.user_preferences.mutations.upsertMyPreferences);
}

// Optimistic toggles: patch the live `getMyPreferences` doc the instant the
// switch is flipped so the control reflects the new value immediately instead
// of freezing for the server round-trip. The patch is a straightforward
// projection of `args.enabled`; `errorToast: false` because the callers toast
// their own (better-copy) error message. Mirrors the reference implementation
// in `governance/hooks/mutations.ts::useUpsertGovernancePolicy`.
export function useSetCustomInstructionsEnabled() {
  return useConvexMutation(
    api.user_preferences.mutations.setCustomInstructionsEnabled,
    {
      errorToast: false,
      optimisticUpdate: (store, args) =>
        updateDocumentQuery(
          store,
          api.user_preferences.queries.getMyPreferences,
          { organizationId: args.organizationId },
          (current) => ({
            ...current,
            customInstructionsEnabled: args.enabled,
          }),
        ),
    },
  );
}

export function useSetMemoriesEnabled() {
  return useConvexMutation(api.user_preferences.mutations.setMemoriesEnabled, {
    errorToast: false,
    optimisticUpdate: (store, args) =>
      updateDocumentQuery(
        store,
        api.user_preferences.queries.getMyPreferences,
        { organizationId: args.organizationId },
        (current) => ({ ...current, memoriesEnabled: args.enabled }),
      ),
  });
}

export function useSetVoiceOutput() {
  return useConvexMutation(api.tts.mutations.setUserVoiceOutput, {
    errorToast: false,
    optimisticUpdate: (store, args) =>
      updateDocumentQuery(
        store,
        api.user_preferences.queries.getMyPreferences,
        { organizationId: args.organizationId },
        (current) => ({ ...current, voiceOutput: args.enabled }),
      ),
  });
}

export function useApprovePendingMemory() {
  return useConvexMutation(api.user_memories.mutations.approvePendingMemory);
}

export function useDismissPendingMemory() {
  return useConvexMutation(api.user_memories.mutations.dismissPendingMemory);
}

export function useSoftDeleteMemory() {
  return useConvexMutation(api.user_memories.mutations.softDeleteMemory);
}
