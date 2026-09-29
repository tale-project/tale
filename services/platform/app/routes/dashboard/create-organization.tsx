import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { FullPageCenter } from '@tale/ui/full-page-center';
import { Stack } from '@tale/ui/layout';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

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
  const { isLoading: isOrgsLoading } = useUserOrganizations();

  // A signed-out visit and a session that ends here belong to the dashboard
  // layout (`routes/dashboard.tsx`): its beforeLoad and re-check send the
  // first to /log-in, and the second keeps this page, and the name typed into
  // the wizard, mounted behind its Sign in / Stay here choice. `isPending`,
  // not `isLoading`: the capabilities read waits for the session probe, and
  // until it has run it is not loading, so the page would say creation is
  // forbidden while the probe catches up.
  if (isOrgsLoading || capabilities.isPending) {
    return <DashboardShellFrame />;
  }

  // Only a read that never answered is an error here. A re-read that fails
  // keeps its last answer: a session ending under the page is met by such a
  // re-read, and must leave the wizard to the layout's Stay here.
  const failed = capabilities.isLoadingError;
  if (failed || !capabilities.data.canCreate) {
    return (
      <FullPageCenter>
        <Stack gap={3} className="max-w-md p-6">
          <Alert
            variant={failed ? 'destructive' : 'info'}
            description={
              failed
                ? tCommon('errors.errorLoadingPage')
                : t('workspace.creationForbidden')
            }
          />
          {failed && (
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
