import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { ContentArea } from '@/app/components/layout/content-area';
import { PageLayout } from '@/app/components/layout/page-layout';
import { SettingsNavigation } from '@/app/features/settings/components/settings-navigation';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings')({
  head: () => ({
    meta: seo('settings'),
  }),
  component: SettingsLayout,
});

function SettingsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t: tNav } = useT('navigation');
  const location = useLocation();
  // Each scope gets its own page title so the header matches the tab strip
  // — user settings reads "Settings", organization settings reads
  // "Organization settings".
  const isUserScope =
    location.pathname.includes('/settings/account') ||
    location.pathname.includes('/settings/personalization');
  const headerTitle = isUserScope ? tNav('userSettings') : tNav('orgSettings');

  return (
    <PageLayout
      organizationId={organizationId}
      header={
        <>
          <AdaptiveHeaderRoot standalone={false}>
            <AdaptiveHeaderTitle>{headerTitle}</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
          <SettingsNavigation organizationId={organizationId} />
        </>
      }
    >
      <ContentArea className="min-h-0 flex-1" variant="page" gap={6}>
        <Outlet />
      </ContentArea>
    </PageLayout>
  );
}
