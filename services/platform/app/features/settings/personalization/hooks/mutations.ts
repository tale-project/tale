import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

/** Turn the custom-instructions feature on or off for this user + org. */
export function useSetCustomInstructionsEnabled() {
  return useBackendMutation(
    'user_preferences/mutations:setCustomInstructionsEnabled',
    { errorToast: false },
  );
}

/** Turn the memories feature on or off for this user + org. */
export function useSetMemoriesEnabled() {
  return useBackendMutation('user_preferences/mutations:setMemoriesEnabled', {
    errorToast: false,
  });
}

/** Store the custom-instructions text itself. */
export function useUpsertMyPreferences() {
  return useBackendMutation('user_preferences/mutations:upsertMyPreferences', {
    errorToast: false,
  });
}

/** Settle a suggestion the model made: save it (approved) or discard it
 * (rejected). Only a saved memory can ever be read back. */
export function useReviewMemory() {
  return useBackendMutation('chat/memories:reviewMemory', {
    errorToast: false,
  });
}

/** Delete a saved memory — it leaves what a search can return. */
export function useDeleteMemory() {
  return useBackendMutation('chat/memories:deleteMemory', {
    errorToast: false,
  });
}
