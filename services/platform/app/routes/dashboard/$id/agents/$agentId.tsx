import { Heading } from '@tale/ui/heading';
import { Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { ContentArea } from '@/app/components/layout/content-area';
import { PageLayout } from '@/app/components/layout/page-layout';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { AgentNavigation } from '@/app/features/agents/components/agent-navigation';
import { useReadAgent } from '@/app/features/agents/hooks/queries';
import { AgentConfigProvider } from '@/app/features/agents/hooks/use-agent-config-context';
import { useT } from '@/lib/i18n/client';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';
import { cn } from '@/lib/utils/cn';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents/$agentId')({
  head: () => ({
    meta: seo('agent'),
  }),
  component: AgentDetailLayout,
});

function AgentDetailLayout() {
  const { id: organizationId, agentId } = Route.useParams();
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  const { data, isLoading, error, refetch } = useReadAgent(
    organizationId,
    agentId,
  );
  const agentConfig = data?.ok ? data.config : null;
  const loadError = data && !data.ok ? data.message : (error?.message ?? null);
  const { i18n: i18nCtx } = useTranslation();
  const resolvedDisplayName = useMemo(
    () =>
      agentConfig
        ? resolveAgentLocale(agentConfig, i18nCtx.language).displayName
        : '',
    [agentConfig, i18nCtx.language],
  );

  // Terminal load failure — not a loading state, so no skeleton here.
  if (!isLoading && (loadError || !agentConfig)) {
    return (
      <PageLayout>
        <ContentArea variant="narrow" className="py-6">
          <Text variant="muted">{loadError ?? t('agents.agentNotFound')}</Text>
        </ContentArea>
      </PageLayout>
    );
  }

  // Breadcrumb header — identical structure in both states; only the agent
  // display name is dynamic, so it is the sole masked leaf. The
  // tab-navigation row and the page body below differ between states because
  // their loaded forms (`AgentNavigation`, the routed `Outlet`) both consume
  // `AgentConfigProvider` and therefore cannot mount until the config loads.
  const breadcrumb = (
    <AdaptiveHeaderRoot standalone={false} className="gap-2">
      <Heading level={1} size="base" truncate>
        <Link
          to="/dashboard/$id/agents"
          params={{ id: organizationId }}
          className={cn(
            'hidden md:inline text-foreground rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
            resolvedDisplayName && 'text-muted-foreground cursor-pointer',
          )}
        >
          {t('agents.title')}&nbsp;&nbsp;
        </Link>
        <span className="text-foreground">
          <span className="hidden md:inline">/&nbsp;&nbsp;</span>
          <Skeletonize loading={isLoading} label={t('agents.title')}>
            <SkeletonBox>
              {resolvedDisplayName || (
                <span className="inline-block h-4 w-32 align-middle" />
              )}
            </SkeletonBox>
          </Skeletonize>
        </span>
      </Heading>
    </AdaptiveHeaderRoot>
  );

  // The body + nav-actions need the agent config to mount; while it loads we
  // render placeholder leaves wrapped in `<Skeletonize loading>` in their
  // place (real `PageLayout`/`ContentArea`/header chrome stays mounted).
  if (isLoading || !agentConfig) {
    return (
      <PageLayout
        header={
          <>
            {breadcrumb}
            <TabNavigation
              items={
                [
                  {
                    label: t('agents.navigation.general'),
                    href: `/dashboard/${organizationId}/agents/${agentId}`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('agents.navigation.instructionsModel'),
                    href: `/dashboard/${organizationId}/agents/${agentId}/instructions`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('agents.navigation.tools'),
                    href: `/dashboard/${organizationId}/agents/${agentId}/tools`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('agents.navigation.skills'),
                    href: `/dashboard/${organizationId}/agents/${agentId}/skills`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('agents.navigation.knowledge'),
                    href: `/dashboard/${organizationId}/agents/${agentId}/knowledge`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('agents.navigation.delegation'),
                    href: `/dashboard/${organizationId}/agents/${agentId}/delegation`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('agents.navigation.conversationStarters'),
                    href: `/dashboard/${organizationId}/agents/${agentId}/conversation-starters`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('agents.navigation.webhook'),
                    href: `/dashboard/${organizationId}/agents/${agentId}/webhook`,
                    matchMode: 'exact',
                  },
                ] satisfies TabNavigationItem[]
              }
              standalone={false}
              ariaLabel={tCommon('aria.agentsNavigation')}
            >
              <Skeletonize loading label={t('agents.title')}>
                <div className="ml-auto flex items-center gap-2">
                  <SkeletonBox>
                    <div className="h-8 w-14 rounded-md" />
                  </SkeletonBox>
                  <SkeletonBox>
                    <div className="h-8 w-20 rounded-md" />
                  </SkeletonBox>
                </div>
              </Skeletonize>
            </TabNavigation>
          </>
        }
      >
        <Skeletonize loading label={t('agents.title')}>
          <ContentArea variant="narrow" className="py-4">
            <Stack gap={6}>
              <Stack gap={1}>
                <SkeletonText lines={1} />
                <SkeletonText lines={1} />
              </Stack>
              <Stack gap={3}>
                <Stack gap={2}>
                  <SkeletonText lines={1} />
                  <SkeletonBox fullWidth>
                    <div className="h-9 w-full" />
                  </SkeletonBox>
                </Stack>
                <SkeletonText lines={1} />
                <Stack gap={2}>
                  <SkeletonText lines={1} />
                  <SkeletonBox fullWidth>
                    <div className="h-9 w-full" />
                  </SkeletonBox>
                </Stack>
                <Stack gap={2}>
                  <SkeletonText lines={1} />
                  <SkeletonBox fullWidth>
                    <div className="h-16 w-full" />
                  </SkeletonBox>
                </Stack>
              </Stack>
            </Stack>
          </ContentArea>
        </Skeletonize>
      </PageLayout>
    );
  }

  return (
    <AgentConfigProvider agentName={agentId} initialConfig={agentConfig}>
      <PageLayout
        header={
          <>
            {breadcrumb}
            <AgentNavigation
              organizationId={organizationId}
              agentId={agentId}
              onSaved={() => {
                void refetch();
              }}
            />
          </>
        }
        organizationId={organizationId}
        className="relative"
      >
        <Outlet />
      </PageLayout>
    </AgentConfigProvider>
  );
}
