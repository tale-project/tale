import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export type Website = ConvexItemOf<typeof api.websites.queries.listWebsites>;

export function useWebsites(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.websites.queries.listWebsites,
    { organizationId },
  );

  return {
    websites: data ?? [],
    isLoading,
  };
}
