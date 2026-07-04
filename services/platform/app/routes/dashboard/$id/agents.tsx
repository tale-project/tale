import {
  createFileRoute,
  Outlet,
  useMatch,
  useNavigate,
} from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents')({
  head: () => ({
    meta: seo('agents'),
  }),
  component: AgentsLayout,
});

function AgentsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('settings');
  const { t: tCatalog } = useT('agentCatalog');
  const { t: tAccessDenied } = useT('accessDenied');

  const navigate = useNavigate();
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  // The agent detail page owns its own header; the layout shows no tabs there.
  const isDetailPage = useMatch({
    from: '/dashboard/$id/agents/$agentId',
    shouldThrow: false,
  });

  // Folder drill-down on the List tab shows a file-system breadcrumb of
  // clickable path segments (the other tabs carry no folder, so no breadcrumb).
  const allMatch = useMatch({
    from: '/dashboard/$id/agents/all',
    shouldThrow: false,
  });
  const currentFolder = allMatch?.search?.folder ?? '';
  const segments = currentFolder ? currentFolder.split('/') : [];

  const goToFolder = (folder: string) =>
    void navigate({
      to: '/dashboard/$id/agents/all',
      params: { id: organizationId },
      search: folder ? { folder } : {},
    });

  // List is the default landing (see agents/index.tsx redirect → /all); the
  // rest are sibling tabs in the order List → Catalog → Metrics.
  // Memoized so TabNavigation's ResizeObserver chain doesn't re-attach each
  // render (see projects/$projectId.tsx).
  const tabs = useMemo<TabNavigationItem[]>(
    () => [
      {
        label: t('agents.tabs.list'),
        href: `/dashboard/${organizationId}/agents/all`,
        matchMode: 'exact',
      },
      {
        label: tCatalog('menuItem'),
        href: `/dashboard/${organizationId}/agents/catalog`,
        matchMode: 'exact',
      },
      {
        label: t('agents.tabs.metrics'),
        href: `/dashboard/${organizationId}/agents/metrics`,
        matchMode: 'exact',
      },
    ],
    [t, tCatalog, organizationId],
  );

  if (!abilityLoading && ability.cannot('write', 'agents')) {
    return <AccessDenied message={tAccessDenied('agents')} />;
  }

  return (
    <PageLayout
      organizationId={organizationId}
      header={
        !isDetailPage ? (
          <>
            <AdaptiveHeaderRoot standalone={false}>
              <AdaptiveHeaderTitle>
                {segments.length > 0 ? (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => goToFolder('')}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t('agents.title')}
                    </button>
                    {segments.map((segment, i) => {
                      const path = segments.slice(0, i + 1).join('/');
                      const isLast = i === segments.length - 1;
                      return (
                        <span key={path} className="flex items-center gap-1">
                          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                          {isLast ? (
                            <span>{segment}</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => goToFolder(path)}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {segment}
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </span>
                ) : (
                  t('agents.title')
                )}
              </AdaptiveHeaderTitle>
            </AdaptiveHeaderRoot>
            <TabNavigation
              items={tabs}
              standalone={false}
              ariaLabel={t('agents.title')}
            />
          </>
        ) : undefined
      }
    >
      {!abilityLoading && <Outlet />}
    </PageLayout>
  );
}
