import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AgentJsonConfig } from '@/convex/agents/file_utils';
import type { AgentReadResult } from '@/convex/agents/file_utils';

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
import { CustomAgentNavigation } from '@/app/features/custom-agents/components/custom-agent-navigation';
import { AgentConfigProvider } from '@/app/features/custom-agents/hooks/use-agent-config-context';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/custom-agents/$agentId')({
  head: () => ({
    meta: seo('customAgent'),
  }),
  component: CustomAgentDetailLayout,
});

function CustomAgentDetailLayout() {
  const { id: organizationId, agentId } = Route.useParams();
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  const [agentConfig, setAgentConfig] = useState<AgentJsonConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const readAgent = useConvexAction(api.agents.file_actions.readAgent);
  const readAgentRef = useRef(readAgent);
  readAgentRef.current = readAgent;

  const loadAgent = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex action returns AgentReadResult but typed as any
      const result = (await readAgentRef.current.mutateAsync({
        orgSlug: 'default',
        agentName: agentId,
      })) as AgentReadResult;

      if (result.ok) {
        setAgentConfig(result.config);
      } else {
        setLoadError(result.message);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load agent');
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void loadAgent();
  }, [loadAgent]);

  if (isLoading) {
    return (
      <PageLayout
        header={
          <>
            <AdaptiveHeaderRoot standalone={false} className="gap-2">
              <Heading level={1} size="base" truncate>
                <Link
                  to="/dashboard/$id/custom-agents"
                  params={{ id: organizationId }}
                  className="text-muted-foreground hidden md:inline"
                >
                  {t('customAgents.title')}&nbsp;&nbsp;
                </Link>
                <span className="hidden md:inline">/&nbsp;&nbsp;</span>
                <Skeleton className="inline-block h-4 w-32 align-middle" />
              </Heading>
            </AdaptiveHeaderRoot>
            <TabNavigation
              items={
                [
                  {
                    label: t('customAgents.navigation.general'),
                    href: `/dashboard/${organizationId}/custom-agents/${agentId}`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('customAgents.navigation.instructionsModel'),
                    href: `/dashboard/${organizationId}/custom-agents/${agentId}/instructions`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('customAgents.navigation.tools'),
                    href: `/dashboard/${organizationId}/custom-agents/${agentId}/tools`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('customAgents.navigation.knowledge'),
                    href: `/dashboard/${organizationId}/custom-agents/${agentId}/knowledge`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('customAgents.navigation.delegation'),
                    href: `/dashboard/${organizationId}/custom-agents/${agentId}/delegation`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('customAgents.navigation.conversationStarters'),
                    href: `/dashboard/${organizationId}/custom-agents/${agentId}/conversation-starters`,
                    matchMode: 'exact',
                  },
                  {
                    label: t('customAgents.navigation.webhook'),
                    href: `/dashboard/${organizationId}/custom-agents/${agentId}/webhook`,
                    matchMode: 'exact',
                  },
                ] satisfies TabNavigationItem[]
              }
              standalone={false}
              ariaLabel={tCommon('aria.customAgentsNavigation')}
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
          <Text variant="muted">
            {loadError ?? t('customAgents.agentNotFound')}
          </Text>
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
                  to="/dashboard/$id/custom-agents"
                  params={{ id: organizationId }}
                  className={cn(
                    'hidden md:inline text-foreground',
                    agentConfig.displayName &&
                      'text-muted-foreground cursor-pointer',
                  )}
                >
                  {t('customAgents.title')}&nbsp;&nbsp;
                </Link>
                {agentConfig.displayName && (
                  <span className="text-foreground">
                    <span className="hidden md:inline">/&nbsp;&nbsp;</span>
                    {agentConfig.displayName}
                  </span>
                )}
              </Heading>
            </AdaptiveHeaderRoot>
            <CustomAgentNavigation
              organizationId={organizationId}
              agentId={agentId}
              onSaved={loadAgent}
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
