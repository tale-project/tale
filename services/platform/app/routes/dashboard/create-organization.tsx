import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { FullPageCenter } from '@tale/ui/full-page-center';
import { Stack } from '@tale/ui/layout';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { DashboardShellFrame } from '@/app/components/layout/dashboard-shell-frame';
import { OnboardingWizard } from '@/app/features/organization/components/onboarding/onboarding-wizard';
import {
  useOrganizationCapabilities,
  useUserOrganizations,
} from '@/app/features/organization/hooks/queries';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/create-organization')({
  head: () => ({
    meta: seo('createOrganization'),
  }),
  component: CreateOrganizationPage,
});

function CreateOrganizationPage() {
  const navigate = useNavigate();
  const capabilities = useOrganizationCapabilities();
  const { t } = useT('onboarding');
  const { t: tCommon } = useT('common');
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

  if (
    isAuthLoading ||
    !isAuthenticated ||
    isOrgsLoading ||
    capabilities.isLoading
  ) {
    return <DashboardShellFrame />;
  }

  if (capabilities.isError || capabilities.data?.canCreate !== true) {
    return (
      <FullPageCenter>
        <Stack gap={3} className="max-w-md p-6">
          <Alert
            variant={capabilities.isError ? 'destructive' : 'info'}
            description={
              capabilities.isError
                ? tCommon('errors.errorLoadingPage')
                : t('workspace.creationForbidden')
            }
          />
          {capabilities.isError && (
            <Button
              variant="secondary"
              onClick={() => void capabilities.refetch()}
            >
              {tCommon('actions.tryAgain')}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => void navigate({ to: '/dashboard' })}
          >
            {t('backToApp')}
          </Button>
        </Stack>
      </FullPageCenter>
    );
  }
  return <OnboardingWizard />;
}
