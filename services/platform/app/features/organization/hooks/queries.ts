import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { UserOrganization } from '@/lib/collections/entities/user-organizations';

import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useUserOrganizations(
  collection: Collection<UserOrganization, string>,
) {
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();

  const { data, isLoading } = useLiveQuery(() => collection);

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
