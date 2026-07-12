import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import {
  createFileRoute,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { useEffect, useMemo, useRef } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

import { METRICS_NAV_ITEMS } from './-nav-items';

/**
 * "Metrics" settings section — the one org-level home for usage, feedback,
 * automation, and project KPIs (#2382). The unified settings rail owns
 * desktop sub-navigation; this layout renders a bounded content pane with a
 * horizontal tab strip on mobile (same shell as the Governance section).
 */
export const Route = createFileRoute('/dashboard/$id/settings/metrics')({
  head: () => ({ meta: seo('metrics') }),
  component: MetricsSettingsLayout,
});

const CONTENT_CLASSNAME = 'flex min-w-0 min-h-0 flex-1 flex-col';

function MetricsSettingsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t: tAccessDenied } = useT('accessDenied');
  const { t } = useT('metrics');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const basePath = `/dashboard/${organizationId}/settings/metrics`;

  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  const tabItems = useMemo<TabNavigationItem[]>(
    () =>
      METRICS_NAV_ITEMS.map((item) => ({
        label: t(`groups.${item.labelKey}`),
        href: `${basePath}/${item.slug}`,
      })),
    [basePath, t],
  );

  // The access check (and therefore the `<Outlet/>`) can't render until the
  // ability resolves, so while it's loading mask the content pane.
  if (abilityLoading) {
    return (
      <Skeletonize loading className={CONTENT_CLASSNAME}>
        <SkeletonBox fullWidth>
          <div className="h-9 w-full rounded-md" />
        </SkeletonBox>
      </Skeletonize>
    );
  }

  if (ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccessDenied('organization')} />;
  }

  return (
    <div ref={contentRef} className={CONTENT_CLASSNAME}>
      <TabNavigation
        items={tabItems}
        matchMode="startsWith"
        ariaLabel={t('title')}
        className="mb-4 grid grid-flow-col items-stretch px-0 md:hidden"
      />
      <Outlet />
    </div>
  );
}
