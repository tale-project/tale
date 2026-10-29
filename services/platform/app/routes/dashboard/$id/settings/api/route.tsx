import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { cn } from '@tale/ui/cn';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import {
  createFileRoute,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/navigation/tab-navigation';
import { agentConnectionAccessQuery } from '@/app/features/settings/agent-connections/hooks/queries';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { useApiSettingsAccess } from '@/app/features/settings/model-endpoints/hooks/use-api-settings-access';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

import {
  API_NAV_ITEMS,
  listedApiAccess,
  tabDeniedMessageKey,
  visibleApiNavItems,
} from './-nav-items';

/**
 * "API" settings section: REST (API keys), Models (the model endpoints for
 * API keys), MCP, Connected agents and WebDAV subpages. The unified settings
 * rail (see `SettingsRail`) owns the desktop sub-navigation — its expanded API
 * section lists these same pages — so this layout renders only a bounded
 * content pane, with a horizontal tab strip on mobile.
 *
 * Owners, admins and developers open every page. A member who may create a
 * personal API key (a competence that is used with one) opens REST, where it
 * is made; one who may call the model endpoints (a `tale:models.api` grant)
 * Models too, where a tool is set up; one who may connect a coding agent, or
 * holds a connection, Connected agents — and no other. While a read that
 * decides a page has failed, the page says the access didn't load and
 * offers to try again; it is never refused on a read that did not answer.
 */
export const Route = createFileRoute('/dashboard/$id/settings/api')({
  head: () => ({ meta: seo('apiKeys') }),
  // Warm what decides whether Connected agents is a tab, without gating
  // navigation on it: the layout waits for the answer itself.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      agentConnectionAccessQuery(params.id),
    );
  },
  component: ApiSettingsLayout,
});

const CONTENT_CLASSNAME = 'flex min-w-0 min-h-0 flex-1 flex-col';

function ApiSettingsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t: tAccessDenied } = useT('accessDenied');
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');

  const access = useApiSettingsAccess(organizationId);
  const listed = listedApiAccess(access);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const basePath = `/dashboard/${organizationId}/settings/api`;
  // The tabs the member may open, and the ones listed: those, and any a
  // failed read left undecided.
  const openItems = useMemo(
    () =>
      visibleApiNavItems({
        developer: access.developer,
        apiKeys: access.apiKeys,
        modelApi: access.modelApi,
        agents: access.agents,
      }),
    [access.developer, access.apiKeys, access.modelApi, access.agents],
  );
  const listedItems = useMemo(
    () =>
      visibleApiNavItems({
        developer: listed.developer,
        apiKeys: listed.apiKeys,
        modelApi: listed.modelApi,
        agents: listed.agents,
      }),
    [listed.developer, listed.apiKeys, listed.modelApi, listed.agents],
  );
  // The page the path names: a tab this member may not open is denied, the
  // way the whole section is for a member who may open none of it — each
  // saying why. A tab a failed read left undecided says the access didn't
  // load instead, as the section does while no tab is known to be open.
  const openSlug = pathname.slice(basePath.length + 1).split('/')[0] ?? '';
  const openItem = API_NAV_ITEMS.find((item) => item.slug === openSlug);
  const tabDenied = openItem !== undefined && !listedItems.includes(openItem);
  const tabUndecided =
    openItem !== undefined
      ? !openItems.includes(openItem)
      : openItems.length === 0;

  const contentRef = useRef<HTMLDivElement>(null);
  // Once the access answers, the failure and its Try again leave; the pane
  // takes the focus instead of the page body.
  const focusContent = useCallback(() => contentRef.current?.focus(), []);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // Mobile swaps the rail for a horizontal tab strip so users can hop between
  // subpages without bouncing back to the settings list.
  const tabItems = useMemo<TabNavigationItem[]>(
    () =>
      listedItems.map((item) => ({
        label: tNav(item.labelKey),
        href: `${basePath}/${item.slug}`,
      })),
    [basePath, tNav, listedItems],
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

  if (listedItems.length === 0) {
    return <AccessDenied message={tAccessDenied('apiKeys')} />;
  }

  if (tabDenied) {
    return (
      <AccessDenied message={tAccessDenied(tabDeniedMessageKey(openItem))} />
    );
  }

  // A failed read: in place of the page it decides, or above an open page
  // while it decides another.
  const failure =
    tabUndecided || listedItems.length > openItems.length ? (
      <CatalogLoadError
        message={tSettings(
          tabUndecided ? 'apiAccess.readFailed' : 'apiAccess.partialReadFailed',
        )}
        onRetry={access.retry}
        isRetrying={access.retrying}
        // Each failure is announced again; Try again keeps its node, and the
        // focus on it, through a retry that fails again.
        failureKey={access.failureCount}
        onFocusLost={focusContent}
      />
    ) : null;

  return (
    <div
      ref={contentRef}
      role="region"
      aria-label={tNav('api')}
      tabIndex={-1}
      className={cn(CONTENT_CLASSNAME, 'outline-none')}
    >
      <TabNavigation
        items={tabItems}
        matchMode="startsWith"
        ariaLabel={tNav('api')}
        className="mb-4 grid grid-flow-col items-stretch px-0 md:hidden"
      />
      {tabUndecided ? (
        <SettingsPage>{failure}</SettingsPage>
      ) : (
        <>
          {failure !== null && (
            <div className="mx-auto mb-6 w-full max-w-3xl">{failure}</div>
          )}
          <Outlet />
        </>
      )}
    </div>
  );
}
