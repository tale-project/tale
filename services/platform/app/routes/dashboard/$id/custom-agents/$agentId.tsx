import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useCallback, useState } from 'react';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { StickyHeader } from '@/app/components/layout/sticky-header';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack, NarrowContainer } from '@/app/components/ui/layout/layout';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { CustomAgentNavigation } from '@/app/features/custom-agents/components/custom-agent-navigation';
import { TestChatPanel } from '@/app/features/custom-agents/components/test-chat-panel';
import {
  useCustomAgentVersions,
  useCustomAgentByVersion,
} from '@/app/features/custom-agents/hooks/queries';
import { CustomAgentVersionProvider } from '@/app/features/custom-agents/hooks/use-custom-agent-version-context';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { seo } from '@/lib/utils/seo';
import { toId } from '@/lib/utils/type-guards';

interface SearchParams {
  v?: number;
}

export const Route = createFileRoute('/dashboard/$id/custom-agents/$agentId')({
  head: () => ({
    meta: seo('customAgent'),
  }),
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    v: typeof search.v === 'number' ? search.v : undefined,
  }),
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.custom_agents.queries.getCustomAgentByVersion, {
        customAgentId: toId<'customAgents'>(params.agentId),
      }),
    );
    void context.queryClient.prefetchQuery(
      convexQuery(api.custom_agents.queries.getCustomAgentVersions, {
        customAgentId: toId<'customAgents'>(params.agentId),
      }),
    );
  },
  component: CustomAgentDetailLayout,
});

function CustomAgentDetailLayout() {
  const { id: organizationId, agentId } = Route.useParams();
  const { v: versionNumber } = Route.useSearch();
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const [isTestOpen, setIsTestOpen] = useState(false);

  const handleTestReset = useCallback(() => {
    setIsTestOpen(false);
    requestAnimationFrame(() => setIsTestOpen(true));
  }, []);

  const { data: agent, isLoading: isLoadingAgent } = useCustomAgentByVersion(
    toId<'customAgents'>(agentId),
    versionNumber,
  );

  const { versions, isLoading: isLoadingVersions } =
    useCustomAgentVersions(agentId);

  if (isLoadingAgent || isLoadingVersions) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <StickyHeader>
          <AdaptiveHeaderRoot standalone={false} className="gap-2">
            <h1 className="truncate text-base font-semibold">
              <Link
                to="/dashboard/$id/custom-agents"
                params={{ id: organizationId }}
                className="text-muted-foreground hidden md:inline"
              >
                {t('customAgents.title')}&nbsp;&nbsp;
              </Link>
              <span className="hidden md:inline">/&nbsp;&nbsp;</span>
              <Skeleton className="inline-block h-4 w-32 align-middle" />
            </h1>
            <Skeleton className="ml-2 h-5 w-16 rounded-full" />
          </AdaptiveHeaderRoot>
          <nav className="border-border relative flex min-h-12 shrink-0 flex-nowrap items-center gap-4 border-b px-4">
            {[56, 128, 40, 80, 64].map((w, i) => (
              <Skeleton key={i} className="h-4" style={{ width: w }} />
            ))}
            <div className="ml-auto flex items-center gap-2">
              <Skeleton className="h-8 w-14 rounded-md" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          </nav>
        </StickyHeader>
        <NarrowContainer className="py-4">
          <Stack gap={6}>
            <Stack gap={1}>
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-4 w-64" />
            </Stack>
            <Stack gap={2}>
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-[1.15rem] w-8 rounded-full" />
              </div>
              <Skeleton className="h-3 w-48" />
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
        </NarrowContainer>
      </div>
    );
  }

  if (!agent) {
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

  return (
    <CustomAgentVersionProvider agent={agent} versions={versions ?? []}>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-auto">
        <StickyHeader>
          <AdaptiveHeaderRoot standalone={false} className="gap-2">
            <h1 className="truncate text-base font-semibold">
              <Link
                to="/dashboard/$id/custom-agents"
                params={{ id: organizationId }}
                className={cn(
                  'hidden md:inline text-foreground',
                  agent.displayName && 'text-muted-foreground cursor-pointer',
                )}
              >
                {t('customAgents.title')}&nbsp;&nbsp;
              </Link>
              {agent.displayName && (
                <span className="text-foreground">
                  <span className="hidden md:inline">/&nbsp;&nbsp;</span>
                  {agent.displayName}
                </span>
              )}
            </h1>
            <Badge
              variant={agent.status === 'active' ? 'green' : 'outline'}
              className="ml-2"
            >
              {tCommon(`status.${agent.status}`)}
            </Badge>
          </AdaptiveHeaderRoot>
          <CustomAgentNavigation
            organizationId={organizationId}
            agentId={agentId}
            onTestClick={() => setIsTestOpen(true)}
          />
        </StickyHeader>

        <LayoutErrorBoundary organizationId={organizationId}>
          <Outlet />
        </LayoutErrorBoundary>

        <Sheet
          open={isTestOpen}
          onOpenChange={setIsTestOpen}
          title={t('customAgents.testChat.title')}
          description={t('customAgents.testChat.welcome')}
          className="flex w-full flex-col p-0 sm:max-w-[480px]"
          hideClose
        >
          <TestChatPanel
            organizationId={organizationId}
            agentId={agentId}
            onClose={() => setIsTestOpen(false)}
            onReset={handleTestReset}
          />
        </Sheet>
      </div>
    </CustomAgentVersionProvider>
  );
}
