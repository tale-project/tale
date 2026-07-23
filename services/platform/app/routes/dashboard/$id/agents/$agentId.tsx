import { Badge } from '@tale/ui/badge';
import { HStack } from '@tale/ui/layout';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useMemo } from 'react';

import { ConfigIcon } from '@/app/components/catalog/config-icon';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { ContentArea } from '@/app/components/layout/content-area';
import { PageLayout } from '@/app/components/layout/page-layout';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { AgentHistoryMenu } from '@/app/features/agents/components/agent-history-menu';
import { useAgent } from '@/app/features/agents/hooks/queries';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents/$agentId')({
  head: () => ({
    meta: seo('agent'),
  }),
  component: AgentDetailLayout,
});

/**
 * One agent's editor shell: identity header (icon, display name, visibility),
 * the version-history menu, and the tab strip — General / Instructions /
 * Tools / Skills / Knowledge, exactly the slim persona the new agent model
 * carries. The retired webhook / environment / starters tabs have no
 * equivalent fields and no routes anymore.
 */
function AgentDetailLayout() {
  const { id: organizationId, agentId: slug } = Route.useParams();
  const { t } = useT('settings');

  const agentQuery = useAgent(organizationId, slug);
  const agent = agentQuery.data;

  const base = `/dashboard/${organizationId}/agents/${slug}`;
  const tabs = useMemo<TabNavigationItem[]>(
    () => [
      {
        label: t('agents.navigation.general'),
        href: base,
        matchMode: 'exact',
      },
      {
        label: t('agents.navigation.instructions'),
        href: `${base}/instructions`,
        matchMode: 'exact',
      },
      {
        label: t('agents.navigation.tools'),
        href: `${base}/tools`,
        matchMode: 'exact',
      },
      {
        label: t('agents.navigation.skills'),
        href: `${base}/skills`,
        matchMode: 'exact',
      },
      {
        label: t('agents.navigation.knowledge'),
        href: `${base}/knowledge`,
        matchMode: 'exact',
      },
    ],
    [base, t],
  );

  return (
    <PageLayout
      header={
        <>
          <AdaptiveHeaderRoot standalone={false}>
            <HStack gap={2} align="center" className="min-w-0">
              <ConfigIcon icon={agent?.icon} className="size-5 shrink-0" />
              <AdaptiveHeaderTitle>
                {agent?.displayName ?? slug}
              </AdaptiveHeaderTitle>
              {agent?.visibility === 'private' && (
                <Badge variant="outline">
                  {t('agents.visibility.private')}
                </Badge>
              )}
            </HStack>
            <AgentHistoryMenu
              organizationId={organizationId}
              slug={slug}
              canEdit={agent?.canEdit ?? false}
            />
          </AdaptiveHeaderRoot>
          <TabNavigation items={tabs} overflow="menu" />
        </>
      }
      organizationId={organizationId}
    >
      <ContentArea className="min-h-0 flex-1 py-4">
        <Outlet />
      </ContentArea>
    </PageLayout>
  );
}
