import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { ConvexItemOf } from '@/lib/types/convex-helpers';

export type Member = ConvexItemOf<
  typeof api.members.queries.listByOrganization
>;

export function useMembers(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.members.queries.listByOrganization,
    { organizationId },
  );

  return {
    members: data,
    isLoading,
  };
}
