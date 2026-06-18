import { createFileRoute, Outlet } from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/apps')({
  component: AppsLayout,
});

function AppsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('apps');
  return (
    <PageLayout
      organizationId={organizationId}
      header={
        <AdaptiveHeaderRoot standalone={false}>
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
      }
    >
      <Outlet />
    </PageLayout>
  );
}
