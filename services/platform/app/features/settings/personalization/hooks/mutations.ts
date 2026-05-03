import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useUpsertMyPreferences() {
  return useConvexMutation(api.user_preferences.mutations.upsertMyPreferences);
}

export function useSetPersonalizationEnabled() {
  return useConvexMutation(api.user_preferences.mutations.setEnabled);
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
