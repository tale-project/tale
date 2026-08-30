import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

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
  return useBackendAction('connector_credentials/actions:createCredential');
}

/** Patch one credential: label, endpoint, status, or its secret. */
export function useUpdateCredential() {
  return useBackendAction('connector_credentials/actions:updateCredential');
}

/** Delete one credential. */
export function useDeleteCredential() {
  return useBackendMutation(
    'connector_credentials/mutations:deleteCredential',
    {
      errorToast: false,
    },
  );
}

/** Make one credential the default of its connector. */
export function useSetDefaultCredential() {
  return useBackendMutation(
    'connector_credentials/mutations:setDefaultCredential',
    { errorToast: false },
  );
}
