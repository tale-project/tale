import { createFileRoute, Outlet } from '@tanstack/react-router';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import { StickyHeader } from '@/app/components/layout/sticky-header';
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
  const { t } = useT('settings');

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <StickyHeader>
        <AdaptiveHeaderRoot standalone={false}>
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
        <SettingsNavigation organizationId={organizationId} />
      </StickyHeader>
      <LayoutErrorBoundary organizationId={organizationId}>
        <ContentWrapper className="p-4">
          <Outlet />
        </ContentWrapper>
      </LayoutErrorBoundary>
    </div>
  );
}
