import { queryOptions } from '@tanstack/react-query';

import { useReactMutation } from '@/app/hooks/use-react-mutation';
import { useReactQuery } from '@/app/hooks/use-react-query';
import { useReactQueryClient } from '@/app/hooks/use-react-query-client';
import { runAdapted } from '@/app/lib/backend/adapters';
import { BackendApiError } from '@/app/lib/backend/api-client';
import { backendEntityPrefix } from '@/app/lib/backend/query-keys';
import { authClient } from '@/lib/auth-client';
import { API_KEY_HINT_ENTITY } from '@/lib/shared/hint-entities';

interface CreateApiKeyParams {
  name: string;
  expiresIn?: number;
}

interface CreateApiKeyResult {
  key: string;
  id: string;
}

/**
 * The API keys read, shared by the page's hook and its route loader so the
 * loader warms the very entry the table reads.
 */
export function apiKeysQuery(organizationId: string) {
  return queryOptions({
    queryKey: ['api-keys', organizationId],
    queryFn: async () => {
      const result = await authClient.apiKey.list();
      if (result.error) {
        throw new Error(result.error.message);
      }
      // authClient.apiKey.list() now returns { apiKeys, total, limit, offset }
      return result.data?.apiKeys ?? [];
    },
  });
}

export function useApiKeys(organizationId: string) {
  return useReactQuery(apiKeysQuery(organizationId));
}

export function useCreateApiKey(organizationId: string) {
  const queryClient = useReactQueryClient();

  return useReactMutation({
    mutationFn: ({
      name,
      expiresIn,
    }: CreateApiKeyParams): Promise<CreateApiKeyResult> =>
      runAdapted(async () => {
        const result = await authClient.apiKey.create({
          name,
          expiresIn,
        });

        if (result.error) {
          throw new BackendApiError(
            result.error.status,
            result.error.message ?? '',
            result.error.code,
          );
        }

        if (!result.data?.key || !result.data?.id) {
          throw new Error('API key creation returned no key/id');
        }

        return {
          key: result.data.key,
          id: result.data.id,
        };
      }),
    // Returned, so the mutation settles only once the list holds the new key.
    // The first key moves the table's Create button from the empty state to
    // the toolbar (a remount); were the success dialog shown first, a quick
    // Done would hand focus to the empty-state button just before the refetch
    // unmounted it, dropping focus to the page. A failed refetch still
    // resolves (`invalidateQueries` never throws), so the key is always shown.
    // The organization's key listing (the budget editor's picker) hears of
    // the change from the backend's hint too; invalidating it here keeps this
    // tab from waiting a hint round-trip.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: apiKeysQuery(organizationId).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: backendEntityPrefix(organizationId, API_KEY_HINT_ENTITY),
        }),
      ]),
  });
}

export function useRevokeApiKey(organizationId: string) {
  const queryClient = useReactQueryClient();

  return useReactMutation({
    mutationFn: async (keyId: string) => {
      const result = await authClient.apiKey.delete({
        keyId,
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['api-keys', organizationId],
      });
      void queryClient.invalidateQueries({
        queryKey: backendEntityPrefix(organizationId, API_KEY_HINT_ENTITY),
      });
    },
  });
}
