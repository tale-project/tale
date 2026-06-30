import { Heading } from '@tale/ui/heading';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import {
  createFileRoute,
  Link,
  Outlet,
  useParams,
} from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { useApps } from '@/app/features/apps/hooks/use-apps';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/apps')({
  head: () => ({
    meta: seo('apps'),
  }),
  component: AppsLayout,
});

/** On an app's detail route, the header becomes a clickable breadcrumb back to
 *  the Apps hub (mirrors the project detail breadcrumb) — `Apps / <app name>`. */
function AppBreadcrumb({
  organizationId,
  appSlug,
  appsTitle,
}: {
  organizationId: string;
  appSlug: string;
  appsTitle: string;
}) {
  const { apps, isLoading } = useApps(organizationId);
  const app = apps.find((a) => a.slug === appSlug);
  return (
    <Heading level={1} size="base" truncate>
      <Link
        to="/dashboard/$id/apps"
        params={{ id: organizationId }}
        className={cn(
          'hidden md:inline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          'text-muted-foreground cursor-pointer',
        )}
      >
        {appsTitle}&nbsp;&nbsp;
      </Link>
      <span className="text-foreground inline-flex items-center gap-2">
        <span className="hidden md:inline">/&nbsp;</span>
        <Skeletonize loading={isLoading && !app} label={appsTitle}>
          {app ? (
            app.name
          ) : (
            <SkeletonBox>
              <span className="inline-block h-4 w-32 align-middle" />
            </SkeletonBox>
          )}
        </Skeletonize>
      </span>
    </Heading>
  );
}

function AppsLayout() {
  const { id: organizationId } = Route.useParams();
  // Non-strict: `appSlug` is present only on the nested detail route, absent on
  // the hub index — exactly when we want the breadcrumb vs. the plain title.
  const { appSlug } = useParams({ strict: false });
  const { t } = useT('apps');
  return (
    <PageLayout
      organizationId={organizationId}
      header={
        <AdaptiveHeaderRoot standalone={false}>
          {appSlug ? (
            <AppBreadcrumb
              organizationId={organizationId}
              appSlug={appSlug}
              appsTitle={t('title')}
            />
          ) : (
            <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
          )}
        </AdaptiveHeaderRoot>
      }
    >
      <Outlet />
    </PageLayout>
  );
}
