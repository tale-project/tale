import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

/**
 * Write hooks for the connectors settings page. The secret-carrying writes
 * (create, update) are Convex ACTIONS — plaintext must reach the node-side
 * encryption layer — while delete and default-swap are plain mutations. The
 * credential list is a reactive query, so none of these invalidate anything.
 * Error feedback belongs to the call sites (dialog-inline or toast, via
 * `mapConnectorError`), so the mutation hooks opt out of the generic toast.
 *
 * OAuth credentials have no write hook here: they are created and refreshed by
 * the consent flow's callback, which the browser reaches through
 * `connector-oauth.ts`.
 */

/** Create one credential for a connector. */
export function useCreateCredential() {
  return useConvexAction(api.connector_credentials.actions.createCredential);
}

/** Patch one credential: label, endpoint, status, or its secret. */
export function useUpdateCredential() {
  return useConvexAction(api.connector_credentials.actions.updateCredential);
}

/** Delete one credential. */
export function useDeleteCredential() {
  return useConvexMutation(
    api.connector_credentials.mutations.deleteCredential,
    { errorToast: false },
  );
}

/** Make one credential the default of its connector. */
export function useSetDefaultCredential() {
  return useConvexMutation(
    api.connector_credentials.mutations.setDefaultCredential,
    { errorToast: false },
  );
}
