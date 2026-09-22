import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

/** Turn the custom-instructions feature on or off for this user + org. */
export function useSetCustomInstructionsEnabled() {
  return useBackendMutation(
    'user_preferences/mutations:setCustomInstructionsEnabled',
    { errorToast: false },
  );
}

/** Store the custom-instructions text itself. */
export function useUpsertMyPreferences() {
  return useBackendMutation('user_preferences/mutations:upsertMyPreferences', {
    errorToast: false,
  });
}
