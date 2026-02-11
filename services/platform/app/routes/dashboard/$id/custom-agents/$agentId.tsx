import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { useMemo, useState } from 'react';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { StickyHeader } from '@/app/components/layout/sticky-header';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack, NarrowContainer } from '@/app/components/ui/layout/layout';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/app/components/ui/overlays/sheet';
import { CustomAgentNavigation } from '@/app/features/custom-agents/components/custom-agent-navigation';
import { TestChatPanel } from '@/app/features/custom-agents/components/test-chat-panel';
import { CustomAgentVersionProvider } from '@/app/features/custom-agents/hooks/use-custom-agent-version-context';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { toId } from '@/lib/utils/type-guards';

interface SearchParams {
  v?: number;
}

export const Route = createFileRoute('/dashboard/$id/custom-agents/$agentId')({
  component: CustomAgentDetailLayout,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    v: typeof search.v === 'number' ? search.v : undefined,
  }),
});

function CustomAgentDetailLayout() {
  const { id: organizationId, agentId } = Route.useParams();
  const { v: versionNumber } = Route.useSearch();
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const [isTestOpen, setIsTestOpen] = useState(false);

  const agent = useQuery(api.custom_agents.queries.getCustomAgentByVersion, {
    customAgentId: toId<'customAgents'>(agentId),
    versionNumber,
  });

  const versions = useQuery(api.custom_agents.queries.getCustomAgentVersions, {
    customAgentId: toId<'customAgents'>(agentId),
  });

  const basePath = `/dashboard/${organizationId}/custom-agents/${agentId}`;

  const loadingNavItems = useMemo(
    (): TabNavigationItem[] => [
      {
        label: t('customAgents.navigation.general'),
        href: basePath,
        matchMode: 'exact',
      },
      {
        label: t('customAgents.navigation.instructionsModel'),
        href: `${basePath}/instructions`,
        matchMode: 'exact',
      },
      {
        label: t('customAgents.navigation.tools'),
        href: `${basePath}/tools`,
        matchMode: 'exact',
      },
      {
        label: t('customAgents.navigation.knowledge'),
        href: `${basePath}/knowledge`,
        matchMode: 'exact',
      },
      {
        label: t('customAgents.navigation.webhook'),
        href: `${basePath}/webhook`,
        matchMode: 'exact',
      },
    ],
    [t, basePath],
  );

  if (agent === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <NarrowContainer className="py-6">
          <p className="text-muted-foreground">
            {t('customAgents.agentNotFound')}
          </p>
        </NarrowContainer>
      </div>
    );
  }

  const isLoading = agent === undefined || versions === undefined;

  const page = (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-auto',
        !isLoading && 'relative',
      )}
    >
      <StickyHeader>
        <AdaptiveHeaderRoot standalone={false} className="gap-2">
          <h1 className="truncate text-base font-semibold">
            <Link
              to="/dashboard/$id/custom-agents"
              params={{ id: organizationId }}
              className={cn(
                'hidden md:inline text-foreground',
                !isLoading &&
                  agent.displayName &&
                  'text-muted-foreground cursor-pointer',
              )}
            >
              {t('customAgents.title')}&nbsp;&nbsp;
            </Link>
            {isLoading ? (
              <Skeleton
                className="inline-block h-4 w-24 align-middle"
                label="Loading agent name"
              />
            ) : (
              agent.displayName && (
                <span className="text-foreground">
                  <span className="hidden md:inline">/&nbsp;&nbsp;</span>
                  {agent.displayName}
                </span>
              )
            )}
          </h1>
          {isLoading ? (
            <Skeleton
              className="ml-2 h-5 w-14 rounded-full"
              label="Loading status"
            />
          ) : (
            <Badge
              variant={agent.status === 'active' ? 'green' : 'outline'}
              className="ml-2"
            >
              {tCommon(`status.${agent.status}`)}
            </Badge>
          )}
        </AdaptiveHeaderRoot>
        {isLoading ? (
          <TabNavigation
            items={loadingNavItems}
            standalone={false}
            ariaLabel={tCommon('aria.customAgentsNavigation')}
          >
            <div className="ml-auto flex items-center gap-2">
              <Skeleton
                className="h-8 w-14 rounded-md"
                label="Loading version"
              />
              <Skeleton
                className="h-8 w-16 rounded-md"
                label="Loading button"
              />
            </div>
          </TabNavigation>
        ) : (
          <CustomAgentNavigation
            organizationId={organizationId}
            agentId={agentId}
            onTestClick={() => setIsTestOpen(true)}
          />
        )}
      </StickyHeader>

      {isLoading ? (
        <NarrowContainer className="py-4">
          <Stack gap={6}>
            <Stack gap={1}>
              <Skeleton className="h-5 w-20" label="Loading section title" />
              <Skeleton className="h-4 w-64" label="Loading description" />
            </Stack>
            <Stack gap={3}>
              <Stack gap={2}>
                <Skeleton className="h-4 w-16" label="Loading label" />
                <Skeleton className="h-9 w-full" label="Loading input" />
              </Stack>
              <Stack gap={2}>
                <Skeleton className="h-4 w-24" label="Loading label" />
                <Skeleton className="h-9 w-full" label="Loading input" />
              </Stack>
              <Stack gap={2}>
                <Skeleton className="h-4 w-20" label="Loading label" />
                <Skeleton
                  className="h-[4.5rem] w-full"
                  label="Loading textarea"
                />
              </Stack>
            </Stack>
          </Stack>
        </NarrowContainer>
      ) : (
        <>
          <LayoutErrorBoundary organizationId={organizationId}>
            <Outlet />
          </LayoutErrorBoundary>

          <Sheet open={isTestOpen} onOpenChange={setIsTestOpen}>
            <SheetContent
              side="right"
              className="flex w-full flex-col p-0 sm:max-w-[480px]"
              hideClose
            >
              <SheetTitle className="sr-only">
                {t('customAgents.testChat.title')}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {t('customAgents.testChat.welcome')}
              </SheetDescription>
              <TestChatPanel
                organizationId={organizationId}
                agentId={agentId}
                onClose={() => setIsTestOpen(false)}
              />
            </SheetContent>
          </Sheet>
        </>
      )}
    </div>
  );

  if (isLoading) {
    return page;
  }

  return (
    <CustomAgentVersionProvider agent={agent} versions={versions}>
      {page}
    </CustomAgentVersionProvider>
  );
}
