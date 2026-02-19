import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useBranding(organizationId: string) {
  return useConvexQuery(api.branding.queries.getBranding, {
    organizationId,
  });
}
