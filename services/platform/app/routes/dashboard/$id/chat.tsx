import { Button } from '@tale/ui/button';
import { createFileRoute, useMatch, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { m, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { z } from 'zod';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { SuspenseBoundary } from '@/app/components/error-boundaries/core/suspense-boundary';
import { PageLayout } from '@/app/components/layout/page-layout';
import { Sheet } from '@/app/components/ui/overlays/sheet';
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
import { useSandboxPanesAvailable } from '@/app/features/chat/hooks/use-sandbox-panes';
import { CanvasPane } from '@/app/features/workspace/components/canvas-pane';
import {
  LiveBrowserProvider,
  useLiveBrowser,
} from '@/app/features/workspace/components/live-browser-context';
import {
  WorkspaceProvider,
  useWorkspace,
} from '@/app/features/workspace/components/workspace-context';
import {
  WorkspaceFilesProvider,
  useWorkspaceFiles,
} from '@/app/features/workspace/components/workspace-files-context';
import { primeCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useIsMobile } from '@/app/hooks/use-is-mobile';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { seo } from '@/lib/utils/seo';

const PlanPane = lazyComponent(() =>
  import('@/app/features/chat/components/plan-pane/plan-pane').then((mod) => ({
    default: mod.PlanPane,
  })),
);

const WorkspaceFilesPane = lazyComponent(() =>
  import('@/app/features/workspace/components/workspace-files-pane').then(
    (mod) => ({
      default: mod.WorkspaceFilesPane,
    }),
  ),
);

const WorkspaceFilesMobileBody = lazyComponent<{ threadId: string }>(() =>
  import('@/app/features/workspace/components/workspace-files-pane').then(
    (mod) => ({
      default: mod.WorkspaceFilesMobileBody,
    }),
  ),
);

const LiveBrowserPane = lazyComponent(() =>
  import('@/app/features/workspace/components/live-browser-pane').then(
    (mod) => ({
      default: mod.LiveBrowserPane,
    }),
  ),
);

const LiveBrowserMobileBody = lazyComponent<{ threadId: string }>(() =>
  import('@/app/features/workspace/components/live-browser-pane').then(
    (mod) => ({
      default: mod.LiveBrowserMobileBody,
    }),
  ),
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
  const { isOpen: isFilesOpen, close: closeFiles } = useWorkspaceFiles();
  const { isOpen: isLiveBrowserOpen, close: closeLiveBrowser } =
    useLiveBrowser();
  // Desktop renders the docked panes; mobile (< md) renders the Sheet variants.
  // The two must be mutually gated: a Sheet's `md:hidden` only hides its content
  // via CSS, but Radix still portals the Dialog backdrop on desktop (it covers
  // the screen + intercepts clicks). Gate each surface on the viewport.
  const isMobile = useIsMobile();
  const { t: tChatFiles } = useT('chat');

  // Read threadId from URL — ChatInterface stays mounted across route changes.
  const threadMatch = useMatch({
    from: '/dashboard/$id/chat/$threadId',
    shouldThrow: false,
  });
  const threadId = threadMatch?.params?.threadId;

  // The read-only sandbox panes (Workspace files + Live browser) only apply to
  // external-agent threads with a session. On desktop the collapsed strips are
  // the open affordance; on mobile the `+`-menu entries are. Gate the mounts so
  // a normal chat thread never shows a stray strip / backdrop.
  const sandboxPanesAvailable = useSandboxPanesAvailable(
    organizationId,
    threadId,
  );

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
      closeFiles();
      closeLiveBrowser();
      setNewChatCount((c) => c + 1);
    }
  }, [threadId, clearChatState, resetWorkspace, closeFiles, closeLiveBrowser]);

  // The workspace-files and live-browser panes are both right-side panes —
  // keep at most one open at a time (opening one closes the other) so the
  // layout never tries to stack two resizable panes on the right edge.
  useEffect(() => {
    if (isFilesOpen && isLiveBrowserOpen) closeFiles();
    // Intentionally not depending on the close callbacks: this fires when
    // either open-state flips, and `isLiveBrowserOpen` going true (the more
    // recent action when both are set on the same tick) wins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveBrowserOpen]);
  useEffect(() => {
    if (isFilesOpen && isLiveBrowserOpen) closeLiveBrowser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFilesOpen]);

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
        {/* Read-only workspace-files explorer — gated to external-agent threads
            with a session. On desktop the collapsed strip IS the open affordance
            (no composer pill); the mobile Sheet below carries it under `md`. */}
        {!isMobile && sandboxPanesAvailable && (
          <LayoutErrorBoundary organizationId={organizationId}>
            <WorkspaceFilesPane />
          </LayoutErrorBoundary>
        )}
        {/* Read-only live-browser stream — independent right-side pane, gated
            identically. At most one of it / workspace-files is open at a time
            (see the mutual-exclusion effects above). Desktop only; the mobile
            Sheet below carries it under `md`. */}
        {!isMobile && sandboxPanesAvailable && (
          <LayoutErrorBoundary organizationId={organizationId}>
            <LiveBrowserPane />
          </LayoutErrorBoundary>
        )}
      </div>

      {/* Mobile: present the workspace-files pane in a right Sheet like the
          mobile history sidebar, so the desktop split-pane never breaks the
          narrow layout. Opened from the `+`-menu (same gate). */}
      {threadId && isMobile && sandboxPanesAvailable && (
        <Sheet
          open={isFilesOpen}
          onOpenChange={(open) => {
            if (!open) closeFiles();
          }}
          side="right"
          title={tChatFiles('workspaceFiles.title')}
          className="w-full p-0 md:hidden"
          // The pane body renders its own close button in the header row; the
          // Sheet's default absolute top-right close would overlap the Refresh
          // action, so suppress it (ESC / overlay-tap still dismiss).
          hideClose
        >
          <LayoutErrorBoundary organizationId={organizationId}>
            <WorkspaceFilesMobileBody threadId={threadId} />
          </LayoutErrorBoundary>
        </Sheet>
      )}

      {/* Mobile: live-browser stream in its own right Sheet (mirrors the
          workspace-files mobile Sheet). Opened from the `+`-menu (same gate). */}
      {threadId && isMobile && sandboxPanesAvailable && (
        <Sheet
          open={isLiveBrowserOpen}
          onOpenChange={(open) => {
            if (!open) closeLiveBrowser();
          }}
          side="right"
          title={tChatFiles('liveBrowser.title')}
          className="w-full p-0 md:hidden"
          // The pane body renders its own close button in the header row (see
          // the workspace-files Sheet above for the same rationale).
          hideClose
        >
          <LayoutErrorBoundary organizationId={organizationId}>
            <LiveBrowserMobileBody threadId={threadId} />
          </LayoutErrorBoundary>
        </Sheet>
      )}
    </PageLayout>
  );
}

function ChatLayout() {
  const { id: organizationId } = Route.useParams();

  return (
    <ChatLayoutProvider organizationId={organizationId}>
      <ArenaModeProvider>
        <WorkspaceProvider>
          <WorkspaceFilesProvider>
            <LiveBrowserProvider>
              <StreamingToolProvider>
                <ChatLayoutContent organizationId={organizationId} />
              </StreamingToolProvider>
            </LiveBrowserProvider>
          </WorkspaceFilesProvider>
        </WorkspaceProvider>
      </ArenaModeProvider>
    </ChatLayoutProvider>
  );
}
