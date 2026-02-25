import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { Spinner } from '@/app/components/ui/feedback/spinner';
import { FullPageCenter } from '@/app/components/ui/layout/full-page-center';
import { OrganizationForm } from '@/app/features/organization/components/organization-form';
import { useUserOrganizations } from '@/app/features/organization/hooks/queries';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/create-organization')({
  head: () => ({
    meta: seo('createOrganization'),
  }),
  component: CreateOrganizationPage,
});

function CreateOrganizationPage() {
  const navigate = useNavigate();
  const {
    organizations,
    isLoading: isOrgsLoading,
    isAuthLoading,
    isAuthenticated,
  } = useUserOrganizations();

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
      <FullPageCenter>
        <Spinner size="lg" />
      </FullPageCenter>
    );
  }

  if (organizations.length > 0) {
    return null;
  }

  return <OrganizationForm />;
}
