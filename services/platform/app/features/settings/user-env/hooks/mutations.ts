import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

/**
 * Upsert one of the calling user's env/secret rows. This is a Node `action`
 * (it authenticates, validates, and encrypts secrets before persisting) and
 * throws a `AppError` with `{ code, message }` on invalid input — callers
 * surface `message` inline.
 */
export function useUpsertMyEnvVar() {
  return useBackendAction('sandbox/user_env_actions:upsertMyEnvVar');
}

/** Delete one of the calling user's env/secret rows. */
export function useDeleteMyEnvVar() {
  // `errorToast: false` — the section toasts its own (better-copy) failure
  // message so a failed delete never lingers silently.
  return useBackendMutation('sandbox/user_env:deleteMyEnvVar', {
    errorToast: false,
  });
}
