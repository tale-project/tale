import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function usePiiConfig(organizationId: string) {
  return useConvexQuery(api.governance.queries.getPiiConfig, {
    organizationId,
  });
}
