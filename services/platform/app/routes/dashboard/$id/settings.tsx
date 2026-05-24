import {
  Link,
  Outlet,
  createFileRoute,
  useLocation,
} from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';

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
  const { t: tCommon } = useT('common');
  const location = useLocation();

  const settingsRoot = `/dashboard/${organizationId}/settings`;
  const isAtIndex = location.pathname === settingsRoot;
  // Show the mobile back-to-settings link only when we're at a direct child of
  // `/settings` (e.g. `/settings/account`). Deeper routes — `governance/<sub>`,
  // `integrations/<sub>` — own their own intra-section back link and would
  // otherwise stack two "Back" bars on top of each other.
  const settingsPath = location.pathname.startsWith(`${settingsRoot}/`)
    ? location.pathname.slice(settingsRoot.length + 1)
    : '';
  const isDirectChild =
    settingsPath !== '' && !settingsPath.replace(/\/$/, '').includes('/');
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
          <div className="hidden md:block">
            <SettingsNavigation organizationId={organizationId} />
          </div>
        </>
      }
    >
      {!isAtIndex && isDirectChild && (
        <Link
          to="/dashboard/$id/settings"
          params={{ id: organizationId }}
          className="text-muted-foreground hover:text-foreground border-border flex items-center gap-1.5 border-b px-4 py-2.5 text-sm font-medium md:hidden"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {tCommon('actions.back')}
        </Link>
      )}
      <ContentArea className="min-h-0 flex-1" variant="page" gap={6}>
        <Outlet />
      </ContentArea>
    </PageLayout>
  );
}
