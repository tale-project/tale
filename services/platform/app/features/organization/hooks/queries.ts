import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/app/hooks/use-session-user';
import {
  organizationQuery,
  organizationCapabilitiesQuery,
  userOrganizationsQuery,
} from '@/app/lib/backend/org';
import { readStateOf } from '@/app/lib/backend/read-state';

export function useUserOrganizations() {
  const { data, isLoading } = useQuery(userOrganizationsQuery());

  return {
    organizations: data,
    isLoading: isLoading,
  };
}

/**
 * The organizations the signed-in person belongs to, with how the read
 * stands (`readStateOf`): a failed read is the caller's to name and retry,
 * never a person in no organization.
 */
export function useUserOrganizationsWithDetails() {
  const { isLoading: isAuthLoading, isAuthenticated } = useAuth();

  const query = useQuery(userOrganizationsQuery());
  const { refetch } = query;

  return {
    organizations: query.data,
    isLoading: query.isLoading,
    isAuthenticated,
    isAuthLoading,
    ...readStateOf(query),
    retry: () => void refetch(),
  };
}

export function useOrganization(organizationId: string) {
  return useQuery(organizationQuery(organizationId));
}

/** Hide create affordances until the deployment confirms self-service creation. */
export function useOrganizationCapabilities() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    ...organizationCapabilitiesQuery(),
    enabled: isAuthenticated,
  });
}
