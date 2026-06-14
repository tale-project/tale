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

import { GOVERNANCE_NAV_ITEMS } from './-nav-items';

export const Route = createFileRoute('/dashboard/$id/settings/governance')({
  head: () => ({ meta: seo('governance') }),
  component: GovernanceLayout,
});

// Bounded-height content pane. The unified settings rail (see `SettingsRail`)
// now owns the desktop sub-navigation — its expanded Governance section lists
// these same groups — so this layout no longer renders its own sidebar. On
// mobile it falls back to a horizontal tab strip. `flex flex-col` lets pages
// opt into bounded-height layouts (via `SettingsPage fitToContainer`) for
// sticky-header data tables; pages that don't opt in render at content height
// and the surrounding `overflow-y-auto` scrolls the whole pane.
const CONTENT_CLASSNAME = 'flex min-w-0 min-h-0 flex-1 flex-col';

function GovernanceLayout() {
  const { id: organizationId } = Route.useParams();
  const { t: tAccessDenied } = useT('accessDenied');
  const { t } = useT('governance');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const basePath = `/dashboard/${organizationId}/settings/governance`;

  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // Mobile swaps the rail for a horizontal tab strip so users can hop between
  // subpages without bouncing back to the settings list.
  const tabItems = useMemo<TabNavigationItem[]>(
    () =>
      GOVERNANCE_NAV_ITEMS.map((item) => ({
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
