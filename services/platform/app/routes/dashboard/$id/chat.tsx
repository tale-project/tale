import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { createFileRoute, useMatch, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { z } from 'zod';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { SuspenseBoundary } from '@/app/components/error-boundaries/core/suspense-boundary';
import { PageLayout } from '@/app/components/layout/page-layout';
import { ArenaModeProvider } from '@/app/features/chat/components/arena/arena-mode-context';
import { BudgetBanner } from '@/app/features/chat/components/budget-banner';
import { ChatHeader } from '@/app/features/chat/components/chat-header';
import { ChatInterface } from '@/app/features/chat/components/chat-interface';
import { ChatMessagesSkeleton } from '@/app/features/chat/components/chat-messages-skeleton';
import {
  ChatPanelProvider,
  useChatPanel,
} from '@/app/features/chat/components/chat-panel/chat-panel-context';
import { SharedChatView } from '@/app/features/chat/components/shared-chat-view';
import { BranchProvider } from '@/app/features/chat/context/branch-context';
import {
  ChatLayoutProvider,
  useChatLayout,
} from '@/app/features/chat/context/chat-layout-context';
import { StreamingToolProvider } from '@/app/features/chat/context/streaming-tool-context';
import {
  THREADS_PAGE_SIZE,
  useArchivedThreads,
} from '@/app/features/chat/hooks/queries';
import { useSandboxPanesAvailable } from '@/app/features/chat/hooks/use-sandbox-panes';
import { CanvasPane } from '@/app/features/workspace/components/canvas-pane';
import { LiveBrowserProvider } from '@/app/features/workspace/components/live-browser-context';
import {
  WorkspaceProvider,
  useWorkspace,
} from '@/app/features/workspace/components/workspace-context';
import { WorkspaceFilesProvider } from '@/app/features/workspace/components/workspace-files-context';
import { primeCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useOptionalTeamFilter } from '@/app/hooks/use-team-filter';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { seo } from '@/lib/utils/seo';

const PlanPane = lazyComponent(() =>
  import('@/app/features/chat/components/plan-pane/plan-pane').then((mod) => ({
    default: mod.PlanPane,
  })),
);

const ChatPanel = lazyComponent(() =>
  import('@/app/features/chat/components/chat-panel/chat-panel').then(
    (mod) => ({
      default: mod.ChatPanel,
    }),
  ),
);

const WorkspaceFilesPane = lazyComponent<{ available: boolean }>(() =>
  import('@/app/features/workspace/components/workspace-files-pane').then(
    (mod) => ({
      default: mod.WorkspaceFilesPane,
    }),
  ),
);

const LiveBrowserPane = lazyComponent<{ available: boolean }>(() =>
  import('@/app/features/workspace/components/live-browser-pane').then(
    (mod) => ({
      default: mod.LiveBrowserPane,
    }),
  ),
);

/**
 * Optional search params for the chat surface. `projectId` is set when the
 * user opens the chat from a project's "New chat" CTA so
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
    // Also prime the archived list — `ThreadGate` seeds an early "archived"
    // classification from it so opening an archived thread never paints the
    // active composer before flipping to the archived footer (#2658). Same
    // args/caveats as the `listThreads` prime above.
    void primeCachedPaginatedQuery(
      context.convexQueryClient.convexClient,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listArchivedThreads's `paginationOpts` is `v.optional`, so the generated type is missing the constraint primeCachedPaginatedQuery expects; same cast pattern as `useArchivedThreads` in features/chat/hooks/queries.ts
      api.threads.queries.listArchivedThreads as unknown as Parameters<
        typeof primeCachedPaginatedQuery
      >[1],
      { organizationId: params.id },
      { initialNumItems: THREADS_PAGE_SIZE },
    );
  },
  component: ChatLayout,
});

/**
 * #2658: while `getThreadStatus` (the authoritative source) is still
 * resolving for a thread, decide what `ChatInterface` should render using the
 * already-loaded archived-threads list as an early "archived" seed (see the
 * seeding comment in `ThreadGate`, which builds `archivedThreadIds`). Pulled
 * out as a pure function — exported so this decision (seed match / neutral
 * hold / fall through to the optimistic composer) has direct unit coverage
 * without mounting `ThreadGate`, which pulls in Convex, the router, and every
 * chat layout provider.
 */
export function resolvePendingThreadGateStatus({
  threadId,
  archivedThreadIds,
}: {
  threadId: string | undefined;
  /** `undefined` while the archived-threads list hasn't resolved even once
   *  this session; the set of archived thread ids once it has. */
  archivedThreadIds: ReadonlySet<string> | undefined;
}): { status: 'archived' | undefined; statusPending: boolean } {
  if (
    archivedThreadIds !== undefined &&
    threadId !== undefined &&
    archivedThreadIds.has(threadId)
  ) {
    return { status: 'archived', statusPending: false };
  }
  if (archivedThreadIds === undefined) {
    return { status: undefined, statusPending: true };
  }
  return { status: undefined, statusPending: false };
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

  // #2658 seed: the archived-threads list is ALREADY subscribed by the
  // sidebar (always-on, not gated by the "Archived" accordion being expanded)
  // with the same `{ teamId, organizationId }` args `useCachedPaginatedQuery`
  // keys its cache on — so by the time a user opens an archived thread from
  // the sidebar, this resolves from that shared cache instantly, well ahead
  // of the per-thread `getThreadStatus` subscription above (which only
  // starts subscribing at navigation). It's a live subscription, not a
  // one-shot fetch, so once resolved it STAYS resolved for the rest of the
  // session — `archivedThreadsLoading` below is therefore only ever true on
  // this session's very first thread open (cold load / deep link).
  //
  // Gate on `isLoading`, not on `archivedThreads` itself being `undefined`:
  // Convex's paginated-query `results` is always an array (`[]` while the
  // first page is in flight, exactly like `useThreads` — see its
  // `isLoadingFirstPage` comment), so an `=== undefined` check on the list
  // never fires and would treat "not loaded yet" as "confirmed empty",
  // reintroducing the active-composer flash on a cold deep link.
  const teamFilter = useOptionalTeamFilter();
  const { threads: archivedThreads, isLoading: archivedThreadsLoading } =
    useArchivedThreads({
      organizationId,
      teamId: teamFilter?.selectedTeamId,
    });
  const archivedThreadIds = useMemo(
    () =>
      archivedThreadsLoading
        ? undefined
        : new Set((archivedThreads ?? []).map((thread) => thread._id)),
    [archivedThreadsLoading, archivedThreads],
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

  const renderInterface = (
    readOnly?: boolean,
    status?: string | null,
    statusPending?: boolean,
  ) => {
    hasRenderedInterfaceRef.current = true;
    return (
      <SuspenseBoundary
        fallback={
          <Stack
            gap={0}
            className="h-full min-h-0 flex-1 overflow-y-auto px-4 sm:px-6"
          >
            <ChatMessagesSkeleton />
          </Stack>
        }
      >
        <ChatInterface
          key={`chat-${newChatCount}`}
          organizationId={organizationId}
          threadId={threadId}
          readOnly={readOnly}
          threadStatus={status}
          threadStatusPending={statusPending}
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
    // Known-archived from the seed → paint the archived footer right away
    // instead of the composer, so there is nothing to flip away from once
    // `getThreadStatus` confirms it a moment later; neither seed nor real
    // status resolved yet (this session's very first thread open) → hold a
    // neutral footer instead of guessing "not archived" (#2658). The message
    // body still renders optimistically below either way.
    const seeded = resolvePendingThreadGateStatus({
      threadId,
      archivedThreadIds,
    });
    return renderInterface(false, seeded.status, seeded.statusPending);
  }

  // Loaded but thread not found / not authorized
  if (threadStatus === null) {
    return (
      <Stack align="center" justify="center" className="h-full p-8">
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
      </Stack>
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
  const { clearChatState } = useChatLayout();
  const { resetWorkspace } = useWorkspace();
  const { reset: resetChatPanel } = useChatPanel();

  // Read threadId from URL — ChatInterface stays mounted across route changes.
  const threadMatch = useMatch({
    from: '/dashboard/$id/chat/$threadId',
    shouldThrow: false,
  });
  const threadId = threadMatch?.params?.threadId;

  // The read-only sandbox panes (Workspace files + Live browser) only apply to
  // external-agent threads with a session — drives whether those two tabs
  // appear in the unified right panel.
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
      resetChatPanel();
      setNewChatCount((c) => c + 1);
    }
  }, [threadId, clearChatState, resetWorkspace, resetChatPanel]);

  // Render shared chat view when on shared route
  if (shareToken) {
    return (
      <PageLayout className="bg-background h-full overflow-hidden">
        <LayoutErrorBoundary organizationId={organizationId}>
          <SuspenseBoundary
            fallback={
              <Stack gap={0} className="h-full overflow-y-auto px-4 sm:px-6">
                <ChatMessagesSkeleton />
              </Stack>
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
      <Stack gap={0} className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <LayoutErrorBoundary organizationId={organizationId}>
          <ChatHeader organizationId={organizationId} threadId={threadId} />
        </LayoutErrorBoundary>

        {/* BranchProvider wraps the message column AND the right-side panes so
              the canvas resolves files against the same active-branch thread the
              message list uses. Without this, the canvas reads files from the raw
              route threadId and branch-tip files vanish after streaming. */}
        <BranchProvider threadId={threadId} organizationId={organizationId}>
          {/* Chat column + right panel strip must stay in a row — BranchProvider
                renders children through Context without a DOM wrapper, so this
                Row is what keeps ChatPanel beside the scroller (not stacked under
                ChatHeader, which collapses the message list to height 0). */}
          <Row
            gap={0}
            align="stretch"
            className="min-h-0 flex-1 overflow-hidden"
          >
            <Stack gap={0} className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <BudgetBanner organizationId={organizationId} />
              <LayoutErrorBoundary organizationId={organizationId}>
                <ThreadGate
                  organizationId={organizationId}
                  threadId={threadId}
                  newChatCount={newChatCount}
                />
              </LayoutErrorBoundary>
            </Stack>

            {/* The four panes are registrars — they publish descriptors to the
                  unified right panel and render nothing themselves. The single
                  <ChatPanel> shell renders the shared strip / tabs / bodies. Plan
                  and Canvas always mount; the sandbox panes (Files + Live browser)
                  register only when `sandboxPanesAvailable`. */}
            <PlanPane />
            <CanvasPane organizationId={organizationId} />
            <WorkspaceFilesPane available={sandboxPanesAvailable} />
            <LiveBrowserPane available={sandboxPanesAvailable} />
            <LayoutErrorBoundary organizationId={organizationId}>
              <ChatPanel />
            </LayoutErrorBoundary>
          </Row>
        </BranchProvider>
      </Stack>
    </PageLayout>
  );
}

function ChatLayout() {
  const { id: organizationId } = Route.useParams();

  return (
    <ChatLayoutProvider organizationId={organizationId}>
      {/* The clock-offset provider lives in the dashboard shell now (the chat
          history sidebar reads relative times on every route); this surface
          only layers the chat-specific providers on top. */}
      <ArenaModeProvider>
        <WorkspaceProvider>
          <WorkspaceFilesProvider>
            <LiveBrowserProvider>
              <ChatPanelProvider>
                <StreamingToolProvider>
                  <ChatLayoutContent organizationId={organizationId} />
                </StreamingToolProvider>
              </ChatPanelProvider>
            </LiveBrowserProvider>
          </WorkspaceFilesProvider>
        </WorkspaceProvider>
      </ArenaModeProvider>
    </ChatLayoutProvider>
  );
}
