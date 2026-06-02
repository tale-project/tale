import { useQueryClient } from '@tanstack/react-query';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

function useInvalidateVectorDb() {
  const queryClient = useQueryClient();
  return (organizationId: string) =>
    queryClient.invalidateQueries({
      queryKey: ['config', 'vectordb', organizationId],
    });
}

export function useSaveVectorDbConfig() {
  const invalidate = useInvalidateVectorDb();
  return useConvexAction(api.vectordb.file_actions.saveVectorDbConfig, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useSaveVectorDbSecret() {
  const invalidate = useInvalidateVectorDb();
  return useConvexAction(api.vectordb.file_actions.saveVectorDbSecret, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useTestVectorDbConnection() {
  return useConvexAction(api.vectordb.file_actions.testVectorDbConnection);
}
