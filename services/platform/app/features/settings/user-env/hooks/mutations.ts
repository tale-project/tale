import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

/**
 * Upsert one of the calling user's env/secret rows. This is a Node `action`
 * (it authenticates, validates, and encrypts secrets before persisting) and
 * throws a `ConvexError` with `{ code, message }` on invalid input — callers
 * surface `message` inline.
 */
export function useUpsertMyEnvVar() {
  return useConvexAction(api.sandbox.user_env_actions.upsertMyEnvVar);
}

/** Delete one of the calling user's env/secret rows. */
export function useDeleteMyEnvVar() {
  // `errorToast: false` — the section toasts its own (better-copy) failure
  // message so a failed delete never lingers silently.
  return useConvexMutation(api.sandbox.user_env.deleteMyEnvVar, {
    errorToast: false,
  });
}
