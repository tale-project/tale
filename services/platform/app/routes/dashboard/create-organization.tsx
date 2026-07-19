import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { DashboardShellFrame } from '@/app/components/layout/dashboard-shell-frame';
import { OnboardingWizard } from '@/app/features/organization/components/onboarding/onboarding-wizard';
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
    isLoading: isOrgsLoading,
    isAuthLoading,
    isAuthenticated,
  } = useUserOrganizations();

  useEffect(() => {
    // Only kick unauthenticated users back to login. Users who already
    // belong to an org can still reach this route to create another one.
    if (!isAuthLoading && !isAuthenticated) {
      void navigate({ to: '/log-in' });
    }
  }, [isAuthLoading, isAuthenticated, navigate]);

  if (isAuthLoading || isOrgsLoading) {
    return <DashboardShellFrame />;
  }

  return <OnboardingWizard />;
}
