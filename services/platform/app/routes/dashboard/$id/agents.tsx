import { createFileRoute, Outlet, useMatch } from '@tanstack/react-router';
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
  const { t: tWorkforce } = useT('workforce');
  const { t: tAccessDenied } = useT('accessDenied');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  // The agent detail page owns its own header; the layout shows no tabs there.
  const isDetailPage = useMatch({
    from: '/dashboard/$id/agents/$agentId',
    shouldThrow: false,
  });

  // Overview (organigram) is the default landing; the rest are sibling tabs.
  // Memoized so TabNavigation's ResizeObserver chain doesn't re-attach each
  // render (see projects/$projectId.tsx).
  const tabs = useMemo<TabNavigationItem[]>(
    () => [
      {
        label: t('agents.tabs.overview'),
        href: `/dashboard/${organizationId}/agents`,
        matchMode: 'exact',
      },
      {
        label: tCatalog('menuItem'),
        href: `/dashboard/${organizationId}/agents/catalog`,
        matchMode: 'exact',
      },
      {
        label: t('agents.tabs.allAgents'),
        href: `/dashboard/${organizationId}/agents/all`,
        matchMode: 'exact',
      },
      {
        label: tWorkforce('title'),
        href: `/dashboard/${organizationId}/agents/metrics`,
        matchMode: 'exact',
      },
    ],
    [t, tCatalog, tWorkforce, organizationId],
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
              <AdaptiveHeaderTitle>{t('agents.title')}</AdaptiveHeaderTitle>
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
