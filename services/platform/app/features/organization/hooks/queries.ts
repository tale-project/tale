import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/app/hooks/use-session-user';
import {
  organizationQuery,
  organizationCapabilitiesQuery,
  userOrganizationsQuery,
} from '@/app/lib/backend/org';

export function useUserOrganizations() {
  const { data, isLoading } = useQuery(userOrganizationsQuery());

  return {
    organizations: data,
    isLoading: isLoading,
  };
}

export function useUserOrganizationsWithDetails() {
  const { isLoading: isAuthLoading, isAuthenticated } = useAuth();

  const { data, isLoading } = useQuery(userOrganizationsQuery());

  return {
    organizations: data,
    isLoading: isLoading,
    isAuthenticated,
    isAuthLoading,
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
