import { useCallback } from 'react';

import { useReactQuery } from '@/app/hooks/use-react-query';
import { useReactQueryClient } from '@/app/hooks/use-react-query-client';
import { authClient } from '@/lib/auth-client';

import type { ApiKey } from '../types';

interface CreateApiKeyParams {
  name: string;
  expiresIn?: number;
}

interface CreateApiKeyResult {
  key: string;
  id: string;
}

export function useApiKeys(organizationId: string) {
  return useReactQuery({
    queryKey: ['api-keys', organizationId],
    queryFn: async () => {
      const result = await authClient.apiKey.list();
      if (result.error) {
        throw new Error(result.error.message);
      }
      // authClient.apiKey.list() returns loosely typed data — cast required for ApiKey shape
      return (result.data ?? []) as ApiKey[];
    },
  });
}

export function useCreateApiKey(organizationId: string) {
  const queryClient = useReactQueryClient();

  return useCallback(
    async ({
      name,
      expiresIn,
    }: CreateApiKeyParams): Promise<CreateApiKeyResult> => {
      const result = await authClient.apiKey.create({
        name,
        expiresIn,
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      if (!result.data?.key || !result.data?.id) {
        throw new Error('API key creation returned no key/id');
      }

      void queryClient.invalidateQueries({
        queryKey: ['api-keys', organizationId],
      });

      return {
        key: result.data.key,
        id: result.data.id,
      };
    },
    [queryClient, organizationId],
  );
}

export function useRevokeApiKey(organizationId: string) {
  const queryClient = useReactQueryClient();

  return useCallback(
    async (keyId: string) => {
      const result = await authClient.apiKey.delete({
        keyId,
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      void queryClient.invalidateQueries({
        queryKey: ['api-keys', organizationId],
      });

      return result.data;
    },
    [queryClient, organizationId],
  );
}
