import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useConvexAuth } from 'convex/react';
import { useEffect } from 'react';

import { OrganizationFormClient } from '@/app/features/organization/components/organization-form-client';
import { api } from '@/convex/_generated/api';

export const Route = createFileRoute('/dashboard/create-organization')({
  component: CreateOrganizationPage,
});

function CreateOrganizationPage() {
  const navigate = useNavigate();
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();

  const organizations = useQuery(
    api.members.queries.getUserOrganizationsList,
    isAuthLoading || !isAuthenticated ? 'skip' : {},
  );

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || organizations === undefined) {
      return;
    }

    if (organizations.length > 0) {
      void navigate({
        to: '/dashboard/$id',
        params: { id: organizations[0].organizationId },
      });
    }
  }, [isAuthLoading, isAuthenticated, organizations, navigate]);

  if (isAuthLoading || organizations === undefined) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  if (organizations.length > 0) {
    return null;
  }

  return <OrganizationFormClient />;
}
