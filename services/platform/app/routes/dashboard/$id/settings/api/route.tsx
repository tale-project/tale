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

import { API_NAV_ITEMS } from './-nav-items';

/**
 * "API" settings section. Consolidates the former top-level API keys and
 * WebDAV pages into one section with REST / WebDAV subpages (the MCP endpoint
 * lives on the Integrations page). The unified settings rail (see
 * `SettingsRail`) owns the desktop sub-navigation — its expanded API section
 * lists these same pages — so this layout renders only a bounded content
 * pane, with a horizontal tab strip on mobile.
 */
export const Route = createFileRoute('/dashboard/$id/settings/api')({
  head: () => ({ meta: seo('apiKeys') }),
  component: ApiSettingsLayout,
});

const CONTENT_CLASSNAME = 'flex min-w-0 min-h-0 flex-1 flex-col';

function ApiSettingsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t: tAccessDenied } = useT('accessDenied');
  const { t: tNav } = useT('navigation');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const basePath = `/dashboard/${organizationId}/settings/api`;

  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // Mobile swaps the rail for a horizontal tab strip so users can hop between
  // subpages without bouncing back to the settings list.
  const tabItems = useMemo<TabNavigationItem[]>(
    () =>
      API_NAV_ITEMS.map((item) => ({
        label: tNav(item.labelKey),
        href: `${basePath}/${item.slug}`,
      })),
    [basePath, tNav],
  );

  if (abilityLoading) {
    return (
      <Skeletonize loading className={CONTENT_CLASSNAME}>
        <SkeletonBox fullWidth>
          <div className="h-9 w-full rounded-md" />
        </SkeletonBox>
      </Skeletonize>
    );
  }

  if (ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={tAccessDenied('apiKeys')} />;
  }

  return (
    <div ref={contentRef} className={CONTENT_CLASSNAME}>
      <TabNavigation
        items={tabItems}
        matchMode="startsWith"
        ariaLabel={tNav('api')}
        className="mb-4 grid grid-flow-col items-stretch px-0 md:hidden"
      />
      <Outlet />
    </div>
  );
}
