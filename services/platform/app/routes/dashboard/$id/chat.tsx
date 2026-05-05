import { Button } from '@tale/ui/button';
import { Skeleton } from '@tale/ui/skeleton';
import { createFileRoute, useMatch, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { m, AnimatePresence } from 'framer-motion';
import { Suspense, useState, useEffect, useRef } from 'react';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { PageLayout } from '@/app/components/layout/page-layout';
import { PanelFooter } from '@/app/components/layout/panel-footer';
import { ArenaModeProvider } from '@/app/features/chat/components/arena/arena-mode-context';
import { BudgetBanner } from '@/app/features/chat/components/budget-banner';
import { ArtifactBar } from '@/app/features/chat/components/canvas/artifact-bar';
import {
  CanvasProvider,
  useCanvas,
} from '@/app/features/chat/components/canvas/canvas-context';
import { ChatHeader } from '@/app/features/chat/components/chat-header';
import { ChatHistorySidebar } from '@/app/features/chat/components/chat-history-sidebar';
import { ChatInterface } from '@/app/features/chat/components/chat-interface';
import { SharedChatView } from '@/app/features/chat/components/shared-chat-view';
import { WelcomeContentSkeleton } from '@/app/features/chat/components/welcome-content-skeleton';
import {
  BranchProvider,
  useBranchContext,
} from '@/app/features/chat/context/branch-context';
import {
  ChatLayoutProvider,
  useChatLayout,
} from '@/app/features/chat/context/chat-layout-context';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { seo } from '@/lib/utils/seo';

const CanvasPane = lazyComponent(() =>
  import('@/app/features/chat/components/canvas/canvas-pane').then((mod) => ({
    default: mod.CanvasPane,
  })),
);

const PlanPane = lazyComponent(() =>
  import('@/app/features/chat/components/plan-pane/plan-pane').then((mod) => ({
    default: mod.PlanPane,
  })),
);

export const Route = createFileRoute('/dashboard/$id/chat')({
  head: () => ({
    meta: seo('chat'),
  }),
  component: ChatLayout,
});

function ChatInputSkeleton() {
  return (
    <PanelFooter>
      <div className="mx-auto w-full max-w-(--chat-max-width)">
        <div className="bg-background border-muted-foreground/50 relative flex flex-col gap-2 rounded-t-2xl border border-b-0 px-5 pt-4">
          <Skeleton className="h-[100px] w-full bg-transparent" />
          <div className="flex items-center pb-3">
            <Skeleton className="h-5 w-5 rounded" />
          </div>
        </div>
      </div>
    </PanelFooter>
  );
}

function ChatSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-visible p-4 sm:p-8">
        <WelcomeContentSkeleton />
      </div>
      <ChatInputSkeleton />
    </div>
  );
}

/**
 * Gates ChatInterface behind a thread ownership check.
 * When a threadId is present, waits for getThreadStatus to resolve:
 * - null while loading → show skeleton
 * - null after load (unauthorized / missing) → show "not found"
 * - valid status → render ChatInterface
 * When no threadId, renders ChatInterface immediately (new chat).
 */
function ThreadGate({
  organizationId,
  threadId,
  newChatCount,
}: {
  organizationId: string;
  threadId: string | undefined;
  newChatCount: number;
}) {
  const { t: tChat } = useT('chat');
  const navigate = useNavigate();
  const { pendingThreadId } = useChatLayout();

  // Skip ownership check for threads we just created — avoids a skeleton
  // flash while the Convex subscription catches up with the new document.
  const isJustCreated = threadId != null && threadId === pendingThreadId;

  // Raw Convex query — stable subscription, no suspense, no react-query wrapper.
  // Returns undefined while loading, null if thread not found / not owned.
  const threadStatus = useQuery(
    api.threads.queries.getThreadStatus,
    threadId && !isJustCreated ? { threadId, organizationId } : 'skip',
  );

  // No threadId or just-created thread → render immediately. BranchProvider
  // is mounted up in ChatLayoutContent, so we don't need to wrap here.
  if (!threadId || isJustCreated) {
    return (
      <Suspense fallback={<ChatSkeleton />}>
        <ChatInterface
          key={`chat-${newChatCount}`}
          organizationId={organizationId}
          threadId={threadId}
        />
      </Suspense>
    );
  }

  // Still loading
  if (threadStatus === undefined) {
    return <ChatSkeleton />;
  }

  // Loaded but thread not found / not authorized
  if (threadStatus === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <p className="text-muted-foreground text-sm">{tChat('notFound')}</p>
        <Button
          variant="secondary"
          onClick={() =>
            void navigate({
              to: '/dashboard/$id/chat',
              params: { id: organizationId },
            })
          }
        >
          {tChat('newChat')}
        </Button>
      </div>
    );
  }

  // Shared read-only access for non-owner org members
  if (threadStatus === 'shared-readonly') {
    return (
      <Suspense fallback={<ChatSkeleton />}>
        <ChatInterface
          key={`chat-${newChatCount}`}
          organizationId={organizationId}
          threadId={threadId}
          readOnly
        />
      </Suspense>
    );
  }

  // Thread is accessible — render ChatInterface
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatInterface
        key={`chat-${newChatCount}`}
        organizationId={organizationId}
        threadId={threadId}
      />
    </Suspense>
  );
}

/**
 * Resolves the active branch threadId from `BranchProvider` and feeds it to
 * `ArtifactBar`. Without this indirection the bar would query the URL's
 * (root) threadId regardless of which branch the user is viewing — see the
 * branch / artifact attribution plan.
 */
function BranchAwareArtifactBar({
  organizationId,
}: {
  organizationId: string;
}) {
  const { activeBranchThreadId, rootThreadId } = useBranchContext();
  const threadId = activeBranchThreadId ?? rootThreadId;
  if (!threadId) return null;
  return <ArtifactBar organizationId={organizationId} threadId={threadId} />;
}

function ChatLayoutContent({ organizationId }: { organizationId: string }) {
  const { isHistoryOpen, clearChatState } = useChatLayout();
  const { resetCanvas } = useCanvas();

  // Read threadId from URL — ChatInterface stays mounted across route changes.
  const threadMatch = useMatch({
    from: '/dashboard/$id/chat/$threadId',
    shouldThrow: false,
  });
  const threadId = threadMatch?.params?.threadId;

  // Check if we're on the shared chat route
  const sharedMatch = useMatch({
    from: '/dashboard/$id/chat/shared/$shareToken',
    shouldThrow: false,
  });
  const shareToken = sharedMatch?.params?.shareToken;

  // Directional key: only remount ChatInterface when entering new-chat from a
  // thread (thread→new). All other transitions (new→thread, thread→thread) keep
  // the same key so the component stays mounted for smooth transitions.
  const [newChatCount, setNewChatCount] = useState(0);
  const prevHadThreadRef = useRef(!!threadId);

  useEffect(() => {
    const hadThread = prevHadThreadRef.current;
    prevHadThreadRef.current = !!threadId;
    if (hadThread && !threadId) {
      clearChatState();
      resetCanvas();
      setNewChatCount((c) => c + 1);
    }
  }, [threadId, clearChatState, resetCanvas]);

  // Render shared chat view when on shared route
  if (shareToken) {
    return (
      <PageLayout className="bg-background h-full overflow-hidden">
        <LayoutErrorBoundary organizationId={organizationId}>
          <Suspense
            fallback={
              <div className="flex h-full flex-col items-center p-8">
                <div className="w-full max-w-(--chat-max-width) space-y-4">
                  <Skeleton className="h-8 w-48" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-3/4" />
                </div>
              </div>
            }
          >
            <SharedChatView
              organizationId={organizationId}
              shareToken={shareToken}
            />
          </Suspense>
        </LayoutErrorBoundary>
      </PageLayout>
    );
  }

  return (
    <PageLayout className="bg-background h-full overflow-hidden">
      <LayoutErrorBoundary organizationId={organizationId}>
        <ChatHeader organizationId={organizationId} threadId={threadId} />
      </LayoutErrorBoundary>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false}>
          {isHistoryOpen && (
            <m.div
              initial={{ width: 0 }}
              animate={{ width: '18rem' }}
              exit={{ width: 0 }}
              transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
              className="relative hidden w-[18rem] shrink-0 md:block"
            >
              <div className="border-border bg-background flex h-full flex-col overflow-hidden border-r">
                <LayoutErrorBoundary organizationId={organizationId}>
                  <ChatHistorySidebar organizationId={organizationId} />
                </LayoutErrorBoundary>
              </div>
            </m.div>
          )}
        </AnimatePresence>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Single BranchProvider scope so ArtifactBar (and the message bubbles
              rendered inside ThreadGate) can both observe the active branch
              and request the right thread's artifacts. Without this, the bar
              shows the URL's root thread regardless of which branch the user
              is viewing. */}
          <BranchProvider threadId={threadId} organizationId={organizationId}>
            <BudgetBanner organizationId={organizationId} />
            {threadId && (
              <BranchAwareArtifactBar organizationId={organizationId} />
            )}
            <LayoutErrorBoundary organizationId={organizationId}>
              <ThreadGate
                organizationId={organizationId}
                threadId={threadId}
                newChatCount={newChatCount}
              />
            </LayoutErrorBoundary>
          </BranchProvider>
        </div>

        <PlanPane />
        <CanvasPane />
      </div>
    </PageLayout>
  );
}

function ChatLayout() {
  const { id: organizationId } = Route.useParams();

  return (
    <ChatLayoutProvider organizationId={organizationId}>
      <ArenaModeProvider>
        <CanvasProvider>
          <ChatLayoutContent organizationId={organizationId} />
        </CanvasProvider>
      </ArenaModeProvider>
    </ChatLayoutProvider>
  );
}
