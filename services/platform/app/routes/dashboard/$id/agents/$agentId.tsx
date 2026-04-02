import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { ContentArea } from '@/app/components/layout/content-area';
import { PageLayout } from '@/app/components/layout/page-layout';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack } from '@/app/components/ui/layout/layout';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { AgentNavigation } from '@/app/features/agents/components/agent-navigation';
import { useReadAgent } from '@/app/features/agents/hooks/queries';
import { AgentConfigProvider } from '@/app/features/agents/hooks/use-agent-config-context';
import { useT } from '@/lib/i18n/client';
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

  const { data, isLoading, error } = useReadAgent('default', agentId);
  const agentConfig = data?.ok ? data.config : null;
  const loadError = data && !data.ok ? data.message : (error?.message ?? null);

  if (isLoading) {
    return (
      <PageLayout
        header={
          <>
            <AdaptiveHeaderRoot standalone={false} className="gap-2">
              <Heading level={1} size="base" truncate>
                <Link
                  to="/dashboard/$id/agents"
                  params={{ id: organizationId }}
                  className="text-muted-foreground hidden md:inline"
                >
                  {t('agents.title')}&nbsp;&nbsp;
                </Link>
                <span className="hidden md:inline">/&nbsp;&nbsp;</span>
                <Skeleton className="inline-block h-4 w-32 align-middle" />
              </Heading>
            </AdaptiveHeaderRoot>
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
              <div className="ml-auto flex items-center gap-2">
                <Skeleton className="h-8 w-14 rounded-md" />
                <Skeleton className="h-8 w-20 rounded-md" />
              </div>
            </TabNavigation>
          </>
        }
      >
        <ContentArea variant="narrow" className="py-4">
          <Stack gap={6}>
            <Stack gap={1}>
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-4 w-64" />
            </Stack>
            <Stack gap={3}>
              <Stack gap={2}>
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-9 w-full" />
              </Stack>
              <Skeleton className="-mt-2 h-3 w-56" />
              <Stack gap={2}>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-9 w-full" />
              </Stack>
              <Stack gap={2}>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-16 w-full" />
              </Stack>
            </Stack>
          </Stack>
        </ContentArea>
      </PageLayout>
    );
  }

  if (loadError || !agentConfig) {
    return (
      <PageLayout>
        <ContentArea variant="narrow" className="py-6">
          <Text variant="muted">{loadError ?? t('agents.agentNotFound')}</Text>
        </ContentArea>
      </PageLayout>
    );
  }

  return (
    <AgentConfigProvider agentName={agentId} initialConfig={agentConfig}>
      <PageLayout
        header={
          <>
            <AdaptiveHeaderRoot standalone={false} className="gap-2">
              <Heading level={1} size="base" truncate>
                <Link
                  to="/dashboard/$id/agents"
                  params={{ id: organizationId }}
                  className={cn(
                    'hidden md:inline text-foreground',
                    agentConfig.displayName &&
                      'text-muted-foreground cursor-pointer',
                  )}
                >
                  {t('agents.title')}&nbsp;&nbsp;
                </Link>
                {agentConfig.displayName && (
                  <span className="text-foreground">
                    <span className="hidden md:inline">/&nbsp;&nbsp;</span>
                    {agentConfig.displayName}
                  </span>
                )}
              </Heading>
            </AdaptiveHeaderRoot>
            <AgentNavigation
              organizationId={organizationId}
              agentId={agentId}
              onSaved={() => {}}
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
