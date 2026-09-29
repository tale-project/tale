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
} from '@/app/components/navigation/tab-navigation';
import { useApiSettingsAccess } from '@/app/features/settings/model-endpoints/hooks/use-api-settings-access';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

import { API_NAV_ITEMS, visibleApiNavItems } from './-nav-items';

/**
 * "API" settings section: REST (API keys), Models (the model endpoints for
 * API keys), MCP and WebDAV subpages. The unified settings rail (see
 * `SettingsRail`) owns the desktop sub-navigation — its expanded API section
 * lists these same pages — so this layout renders only a bounded content
 * pane, with a horizontal tab strip on mobile.
 *
 * Owners, admins and developers open every page; a member who may create a
 * personal API key (a competence that is used with one) opens REST, where it
 * is made, and one who may call the model endpoints (a `tale:models.api`
 * grant) Models too, where a tool is set up — and no other.
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

  const access = useApiSettingsAccess(organizationId);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const basePath = `/dashboard/${organizationId}/settings/api`;
  const visibleItems = useMemo(
    () =>
      visibleApiNavItems({
        developer: access.developer,
        apiKeys: access.apiKeys,
        modelApi: access.modelApi,
      }),
    [access.developer, access.apiKeys, access.modelApi],
  );
  // The page the path names: a tab this member may not open is denied, the
  // way the whole section is for a member who may open none of it — each
  // saying why.
  const openSlug = pathname.slice(basePath.length + 1).split('/')[0] ?? '';
  const openItem = API_NAV_ITEMS.find((item) => item.slug === openSlug);
  const tabDenied = openItem !== undefined && !visibleItems.includes(openItem);

  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // Mobile swaps the rail for a horizontal tab strip so users can hop between
  // subpages without bouncing back to the settings list.
  const tabItems = useMemo<TabNavigationItem[]>(
    () =>
      visibleItems.map((item) => ({
        label: tNav(item.labelKey),
        href: `${basePath}/${item.slug}`,
      })),
    [basePath, tNav, visibleItems],
  );

  if (access.loading) {
    return (
      <Skeletonize loading className={CONTENT_CLASSNAME}>
        <SkeletonBox fullWidth>
          <div className="h-9 w-full rounded-md" />
        </SkeletonBox>
      </Skeletonize>
    );
  }

  if (visibleItems.length === 0) {
    return <AccessDenied message={tAccessDenied('apiKeys')} />;
  }

  if (tabDenied) {
    return (
      <AccessDenied
        message={tAccessDenied(
          openItem.audience === 'modelApi' ? 'apiModels' : 'apiTab',
        )}
      />
    );
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
