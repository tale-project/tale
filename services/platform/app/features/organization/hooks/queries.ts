import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/app/hooks/use-session-user';
import {
  organizationQuery,
  organizationCapabilitiesQuery,
  userOrganizationsQuery,
} from '@/app/lib/backend/org';

export function useUserOrganizations() {
  // The session probe, not the websocket: the boot chain must resolve on
  // the cookie alone (the 0.5 posture — WS auth dies at cutover).
  const { isLoading: isAuthLoading, isAuthenticated } = useAuth();

  const { data, isLoading } = useQuery(userOrganizationsQuery());

  return {
    organizations: data,
    isLoading: isLoading,
    isAuthenticated,
    isAuthLoading,
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
