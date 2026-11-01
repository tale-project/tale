import { type QueryClient, queryOptions } from '@tanstack/react-query';

import { useReactMutation } from '@/app/hooks/use-react-mutation';
import { useReactQuery } from '@/app/hooks/use-react-query';
import { useReactQueryClient } from '@/app/hooks/use-react-query-client';
import { runAdapted } from '@/app/lib/backend/adapters';
import { BackendApiError, backendFetch } from '@/app/lib/backend/api-client';
import { backendKey } from '@/app/lib/backend/query-keys';
import { authClient } from '@/lib/auth-client';
import { API_KEY_HINT_ENTITY } from '@/lib/shared/hint-entities';

import type {
  ApiKey,
  ApiKeyListing,
  ApiKeyListScope,
  ApiKeyOwnerInput,
  MemberPersonalApiKeys,
} from '../types';

interface CreateApiKeyParams {
  name: string;
  expiresIn?: number;
  owner: ApiKeyOwnerInput;
}

interface CreateApiKeyResult {
  key: string;
  id: string;
}

/**
 * The API keys read, shared by the page's hook and its route loader so the
 * loader warms the very entry the table reads: the viewer's own keys, the
 * keys made for them here and — for an Owner or Admin — every key bound to
 * the organization. An Owner or Admin may also ask for every key that works
 * here (`all`), which adds the members' own keys while they work here and
 * says whether they do (`personalKeys`). Keyed under the `api_key` hint
 * entity, so a key another admin makes or ends here, or the switch for the
 * members' own keys, refreshes the open list.
 */
export function apiKeysQuery(
  organizationId: string,
  scope: ApiKeyListScope = 'managed',
) {
  return queryOptions({
    queryKey:
      scope === 'managed'
        ? backendKey(organizationId, API_KEY_HINT_ENTITY, 'settings-list')
        : backendKey(
            organizationId,
            API_KEY_HINT_ENTITY,
            'settings-list',
            scope,
          ),
    queryFn: ({ signal }) =>
      backendFetch<ApiKeyListing>(
        scope === 'managed'
          ? '/api-keys'
          : `/api-keys?${new URLSearchParams({ scope })}`,
        { orgId: organizationId, signal },
      ),
    // Every key that works here also changes when a member is disabled or
    // leaves, which sends no `api_key` hint: read afresh each time the view
    // opens, never from the router's stale window.
    ...(scope === 'all' ? { staleTime: 0 } : {}),
  });
}

export function useApiKeys(
  organizationId: string,
  scope: ApiKeyListScope = 'managed',
) {
  return useReactQuery(apiKeysQuery(organizationId, scope));
}

/**
 * Every view of API keys, in every organization the cache holds: the viewer's
 * own key works in all of them, so each list — this page's and the budget
 * editor's picker — may have changed. Active views refetch; the others are
 * marked stale and refetch when reopened.
 */
function invalidateApiKeyViews(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === 'backend' && queryKey[2] === API_KEY_HINT_ENTITY,
  });
}

export function useCreateApiKey(organizationId: string) {
  const queryClient = useReactQueryClient();

  return useReactMutation({
    mutationFn: ({
      name,
      expiresIn,
      owner,
    }: CreateApiKeyParams): Promise<CreateApiKeyResult> =>
      runAdapted(async () => {
        if (owner.kind !== 'self') {
          // A key for a member, a team, a project or the organization: the
          // organization's own door, bound to it.
          const created = await backendFetch<{ id: string; key: string }>(
            '/api-keys',
            {
              orgId: organizationId,
              method: 'POST',
              body: {
                name,
                ...(expiresIn !== undefined ? { expiresIn } : {}),
                owner,
              },
            },
          );
          return { key: created.key, id: created.id };
        }
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
    onSuccess: () => invalidateApiKeyViews(queryClient),
  });
}

export function useRevokeApiKey(organizationId: string) {
  const queryClient = useReactQueryClient();

  return useReactMutation({
    mutationFn: async (apiKey: Pick<ApiKey, 'id' | 'owner'>) => {
      if (apiKey.owner.kind !== 'user') {
        // A key bound to this organization ends at its own door, which
        // stamps the binding and writes the trail here.
        await backendFetch(`/api-keys/${encodeURIComponent(apiKey.id)}`, {
          orgId: organizationId,
          method: 'DELETE',
        });
        return;
      }
      const result = await authClient.apiKey.delete({
        keyId: apiKey.id,
      });

      if (result.error) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: () => invalidateApiKeyViews(queryClient),
  });
}

/**
 * A member's own keys, for an Owner or Admin on the member's row, with this
 * organization's block on each (APIKEY-R11). Keyed under the `api_key` hint
 * entity, so a block another admin sets here refreshes the open dialog.
 */
export function memberPersonalApiKeysQuery(
  organizationId: string,
  userId: string,
) {
  return queryOptions({
    queryKey: backendKey(
      organizationId,
      API_KEY_HINT_ENTITY,
      'member-personal',
      userId,
    ),
    queryFn: ({ signal }) =>
      backendFetch<MemberPersonalApiKeys>(
        `/api-keys/members/${encodeURIComponent(userId)}/personal`,
        { orgId: organizationId, signal },
      ),
  });
}

export function useMemberPersonalApiKeys(
  organizationId: string,
  userId: string,
  options: { enabled: boolean },
) {
  return useReactQuery({
    ...memberPersonalApiKeysQuery(organizationId, userId),
    enabled: options.enabled,
  });
}

/** Block a member's own key in this organization, or lift the block. */
export function useSetApiKeyBlock(organizationId: string) {
  const queryClient = useReactQueryClient();

  return useReactMutation({
    mutationFn: async ({
      keyId,
      blocked,
    }: {
      keyId: string;
      blocked: boolean;
    }) => {
      await backendFetch(`/api-keys/${encodeURIComponent(keyId)}/block`, {
        orgId: organizationId,
        method: blocked ? 'PUT' : 'DELETE',
      });
    },
    onSuccess: () => invalidateApiKeyViews(queryClient),
  });
}
