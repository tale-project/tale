import { useQueryClient } from '@tanstack/react-query';

import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

import { providerCatalogsQueryKey } from './queries';

/**
 * Write hooks for the AI-providers settings page. The secret-carrying writes
 * (create, update) are actions — plaintext must reach the encryption layer —
 * while delete and default-swap are plain mutations. None of them invalidates
 * anything here: their adapter rows refresh the provider-credential entity,
 * which holds the credential list and every read derived from it (the model
 * pickers, the runtime status, the resolved vision model). The catalog
 * refresh's row does the same — those reads answer from the catalogs too —
 * and its hook also invalidates the catalog listing, which only a refresh
 * changes. Error feedback is handled at the call sites (dialog-inline or
 * toast, via `mapCredentialError`), so the mutation hooks opt out of the
 * generic error toast.
 */

/** Create one credential (api-key / env / subscription-broker). */
export function useCreateCredential() {
  return useBackendAction('provider_credentials/actions:createCredential');
}

/** Patch one credential: name, allowlist, status, default flag, or secret. */
export function useUpdateCredential() {
  return useBackendAction('provider_credentials/actions:updateCredential');
}

/** Delete one credential. Deleting the default leaves the pair without one. */
export function useDeleteCredential() {
  return useBackendMutation('provider_credentials/mutations:deleteCredential', {
    errorToast: false,
  });
}

/** Make one credential the default of its (org, provider) pair. */
export function useSetDefaultCredential() {
  return useBackendMutation(
    'provider_credentials/mutations:setDefaultCredential',
    { errorToast: false },
  );
}

/** Force-refresh the live-source catalogs, then refetch the listing. */
export function useRefreshProviderCatalogs(organizationId: string) {
  const queryClient = useQueryClient();
  return useBackendAction(
    'lib/providers/catalog_actions:refreshProviderCatalogs',
    {
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: providerCatalogsQueryKey(organizationId),
        }),
    },
  );
}
