import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { OrganizationFormClient } from '@/app/features/organization/components/organization-form-client';
import { useUserOrganizationCollection } from '@/app/features/organization/hooks/collections';
import { useUserOrganizations } from '@/app/features/organization/hooks/queries';

export const Route = createFileRoute('/dashboard/create-organization')({
  component: CreateOrganizationPage,
});

function CreateOrganizationPage() {
  const navigate = useNavigate();
  const {
    organizations,
    isLoading: isOrgsLoading,
    isAuthLoading,
    isAuthenticated,
  } = useUserOrganizations(useUserOrganizationCollection());

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || isOrgsLoading || !organizations) {
      return;
    }

    const firstOrgId = organizations[0]?.organizationId;
    if (firstOrgId) {
      void navigate({
        to: '/dashboard/$id',
        params: { id: firstOrgId },
      });
    }
  }, [isAuthLoading, isAuthenticated, isOrgsLoading, organizations, navigate]);

  if (isAuthLoading || isOrgsLoading || !organizations) {
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
