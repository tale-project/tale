import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { useState } from 'react';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { StickyHeader } from '@/app/components/layout/sticky-header';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack, NarrowContainer } from '@/app/components/ui/layout/layout';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/app/components/ui/overlays/sheet';
import { CustomAgentNavigation } from '@/app/features/custom-agents/components/custom-agent-navigation';
import { TestChatPanel } from '@/app/features/custom-agents/components/test-chat-panel';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

export const Route = createFileRoute('/dashboard/$id/custom-agents/$agentId')({
  component: CustomAgentDetailLayout,
});

function CustomAgentDetailLayout() {
  const { id: organizationId, agentId } = Route.useParams();
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const [isTestOpen, setIsTestOpen] = useState(false);

  const agent = useQuery(api.custom_agents.queries.getCustomAgent, {
    customAgentId: agentId as Id<'customAgents'>,
  });

  if (agent === undefined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <StickyHeader>
          <AdaptiveHeaderRoot standalone={false} className="gap-2">
            <Skeleton className="h-5 w-40" />
          </AdaptiveHeaderRoot>
        </StickyHeader>
        <NarrowContainer className="py-6">
          <Stack gap={4}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Stack gap={2} key={i}>
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-9 w-full" />
              </Stack>
            ))}
          </Stack>
        </NarrowContainer>
      </div>
    );
  }

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

  return (
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
          <Badge variant="outline" className="ml-2">
            {tCommon('status.draft')}
          </Badge>
        </AdaptiveHeaderRoot>
        <CustomAgentNavigation
          organizationId={organizationId}
          agentId={agentId}
          currentVersion={agent.versionNumber}
          onTestClick={() => setIsTestOpen(true)}
        />
      </StickyHeader>
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
    </div>
  );
}
