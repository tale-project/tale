import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

export function useApiKeys() {
  return useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const result = await authClient.apiKey.list();
      if (result.error) {
        throw new Error(result.error.message);
      }
      return (result.data ?? []) as ApiKey[];
    },
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ name, expiresIn }: CreateApiKeyParams): Promise<CreateApiKeyResult> => {
      const result = await authClient.apiKey.create({
        name,
        expiresIn,
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      return {
        key: result.data?.key ?? '',
        id: result.data?.id ?? '',
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
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
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
}
