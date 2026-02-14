import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export type UserOrganization = ConvexItemOf<
  typeof api.members.queries.getUserOrganizationsList
>;

export function useUserOrganizations() {
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();

  const { data, isLoading } = useConvexQuery(
    api.members.queries.getUserOrganizationsList,
  );

  return {
    organizations: data,
    isLoading: isAuthLoading || isLoading,
    isAuthenticated,
    isAuthLoading,
  };
}

export function useOrganization(organizationId: string) {
  return useConvexQuery(api.organizations.queries.getOrganization, {
    id: organizationId,
  });
}
