import { Button } from '@tale/ui/button';
import { createFileRoute, useMatch, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { m, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { z } from 'zod';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { SuspenseBoundary } from '@/app/components/error-boundaries/core/suspense-boundary';
import { PageLayout } from '@/app/components/layout/page-layout';
import { ArenaModeProvider } from '@/app/features/chat/components/arena/arena-mode-context';
import { BudgetBanner } from '@/app/features/chat/components/budget-banner';
import { ChatHeader } from '@/app/features/chat/components/chat-header';
import { ChatHistorySidebar } from '@/app/features/chat/components/chat-history-sidebar';
import { ChatInterface } from '@/app/features/chat/components/chat-interface';
import { ChatMessagesSkeleton } from '@/app/features/chat/components/chat-messages-skeleton';
import { SharedChatView } from '@/app/features/chat/components/shared-chat-view';
import { BranchProvider } from '@/app/features/chat/context/branch-context';
import {
  ChatLayoutProvider,
  useChatLayout,
} from '@/app/features/chat/context/chat-layout-context';
import { StreamingToolProvider } from '@/app/features/chat/context/streaming-tool-context';
import { THREADS_PAGE_SIZE } from '@/app/features/chat/hooks/queries';
import { CanvasPane } from '@/app/features/workspace/components/canvas-pane';
import {
  WorkspaceProvider,
  useWorkspace,
} from '@/app/features/workspace/components/workspace-context';
import { primeCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { seo } from '@/lib/utils/seo';

const PlanPane = lazyComponent(() =>
  import('@/app/features/chat/components/plan-pane/plan-pane').then((mod) => ({
    default: mod.PlanPane,
  })),
);

/**
 * Optional search params for the chat surface. `projectId` is set when the
 * user opens the chat from a project's "New chat in this project" CTA so
 * `useSendMessage` can forward it to `chatWithAgent` for server-side
 * project-access validation.
 */
const chatSearchSchema = z.object({
  projectId: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/chat')({
  head: () => ({
    meta: seo('chat'),
  }),
  validateSearch: chatSearchSchema,
  // The history sidebar is off-screen on first paint (collapsed by default on
  // most viewports), so the threads list isn't on the critical path — fire
  // the cache prime fire-and-forget so by the time the user opens the
  // sidebar the first page is already warm. `primeCachedPaginatedQuery`
  // skips the network call when the key is already cached, so re-navs to
  // the chat route after the cache is filled are free.
  //
  // Args mirror `useThreads`'s base call site (`{ organizationId }` only —
  // no `teamId`). When a team is selected the hook's cache key differs and
  // we'll miss the prime; that's still correct (we'd just see the normal
  // first-load skeleton), and the more common "no team scope" case wins.
  loader: ({ context, params }) => {
    // `listThreads`'s `paginationOpts` is `v.optional(...)` (it tolerates
    // reconnection replays that drop the arg), so the generated type doesn't
    // satisfy Convex's `PaginatedQueryReference` constraint. The runtime call
    // shape is correct — the same cast is used by `useThreads` for the same
    // reason. See `services/platform/app/features/chat/hooks/queries.ts`.
    void primeCachedPaginatedQuery(
      context.convexQueryClient.convexClient,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listThreads's `paginationOpts` is `v.optional`, so the generated type is missing the constraint primeCachedPaginatedQuery expects; same cast pattern as `useThreads` in features/chat/hooks/queries.ts
      api.threads.queries.listThreads as unknown as Parameters<
        typeof primeCachedPaginatedQuery
      >[1],
      { organizationId: params.id },
      { initialNumItems: THREADS_PAGE_SIZE },
    );
  },
  component: ChatLayout,
});

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

  // Once we've rendered ChatInterface for any thread this session, keep it
  // mounted across thread→thread switches instead of swapping to the loading
  // skeleton while getThreadStatus does its round-trip. That full-component
  // swap (interface → skeleton → interface) was the flicker/layout-shift on
  // switching chats. Message queries are auth-checked server-side, so the
  // optimistic render is safe; an unauthorized thread still resolves to the
  // not-found branch below. Only a cold first paint / deep link shows the
  // skeleton. (Ref mutation during render is intentional and idempotent.)
  const hasRenderedInterfaceRef = useRef(false);

  const renderInterface = (readOnly?: boolean, status?: string | null) => {
    hasRenderedInterfaceRef.current = true;
    return (
      <SuspenseBoundary
        fallback={
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto px-4 sm:px-6">
            <ChatMessagesSkeleton />
          </div>
        }
      >
        <ChatInterface
          key={`chat-${newChatCount}`}
          organizationId={organizationId}
          threadId={threadId}
          readOnly={readOnly}
          threadStatus={status}
        />
      </SuspenseBoundary>
    );
  };

  // No threadId or just-created thread → render immediately. BranchProvider
  // is mounted up in ChatLayoutContent, so we don't need to wrap here.
  if (!threadId || isJustCreated) {
    return renderInterface();
  }

  // Still loading ownership: render the real ChatInterface optimistically (its
  // own Skeletonize-wrapped welcome/message states cover the load). Message
  // queries are auth-checked server-side, so this is safe; an unauthorized
  // thread still resolves to the not-found branch below once status arrives.
  if (threadStatus === undefined) {
    return renderInterface();
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
    return renderInterface(true, threadStatus);
  }

  // Thread is accessible — render ChatInterface (pass the resolved status so
  // ChatInterface can derive `isArchived` without a second subscription).
  return renderInterface(false, threadStatus);
}

function ChatLayoutContent({ organizationId }: { organizationId: string }) {
  const { isHistoryOpen, clearChatState } = useChatLayout();
  const { resetWorkspace } = useWorkspace();

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
      resetWorkspace();
      setNewChatCount((c) => c + 1);
    }
  }, [threadId, clearChatState, resetWorkspace]);

  // Render shared chat view when on shared route
  if (shareToken) {
    return (
      <PageLayout className="bg-background h-full overflow-hidden">
        <LayoutErrorBoundary organizationId={organizationId}>
          <SuspenseBoundary
            fallback={
              <div className="flex h-full flex-col overflow-y-auto px-4 sm:px-6">
                <ChatMessagesSkeleton />
              </div>
            }
          >
            <SharedChatView
              organizationId={organizationId}
              shareToken={shareToken}
            />
          </SuspenseBoundary>
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
          <BranchProvider threadId={threadId} organizationId={organizationId}>
            <BudgetBanner organizationId={organizationId} />
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
        <CanvasPane organizationId={organizationId} />
      </div>
    </PageLayout>
  );
}

function ChatLayout() {
  const { id: organizationId } = Route.useParams();

  return (
    <ChatLayoutProvider organizationId={organizationId}>
      <ArenaModeProvider>
        <WorkspaceProvider>
          <StreamingToolProvider>
            <ChatLayoutContent organizationId={organizationId} />
          </StreamingToolProvider>
        </WorkspaceProvider>
      </ArenaModeProvider>
    </ChatLayoutProvider>
  );
}
