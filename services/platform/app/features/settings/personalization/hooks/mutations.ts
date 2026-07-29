import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

/** Turn the custom-instructions feature on or off for this user + org. */
export function useSetCustomInstructionsEnabled() {
  return useConvexMutation(
    api.user_preferences.mutations.setCustomInstructionsEnabled,
    { errorToast: false },
  );
}

/** Turn the memories feature on or off for this user + org. */
export function useSetMemoriesEnabled() {
  return useConvexMutation(api.user_preferences.mutations.setMemoriesEnabled, {
    errorToast: false,
  });
}

/** Store the custom-instructions text itself. */
export function useUpsertMyPreferences() {
  return useConvexMutation(api.user_preferences.mutations.upsertMyPreferences, {
    errorToast: false,
  });
}
