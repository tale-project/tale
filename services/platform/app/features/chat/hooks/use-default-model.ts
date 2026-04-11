import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useDefaultModel(organizationId: string) {
  return useConvexQuery(api.governance.default_model_query.getMyDefaultModel, {
    organizationId,
  });
}
