'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useParams, useNavigate, useRouter } from '@tanstack/react-router';
import {
  ChevronDown,
  CircleDotIcon,
  FolderPlus,
  MessageSquareDashedIcon,
  MoreHorizontal,
  Pin,
  PinOff,
  Search,
  Share2Icon,
  SquarePen,
} from 'lucide-react';
import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
  useMemo,
  useSyncExternalStore,
} from 'react';

import { useSidebar } from '@/app/components/layout/app-sidebar/sidebar-context';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { ProjectAvatar } from '@/app/features/projects/components/project-avatar';
import { ProjectCreateDialog } from '@/app/features/projects/components/project-create-dialog';
import { useSetProjectPinned } from '@/app/features/projects/hooks/mutations';
import {
  useProjects,
  useProjectThreads,
  type ProjectListItem,
} from '@/app/features/projects/hooks/queries';
import { useActiveHoldTargetIds } from '@/app/features/settings/governance/hooks/queries';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useRelativeNow } from '@/app/hooks/use-relative-now';
import { useOptionalTeamFilter } from '@/app/hooks/use-team-filter';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useUpdateThread } from '../hooks/mutations';
import {
  useActiveApprovals,
  useArchivedThreads,
  useThreads,
} from '../hooks/queries';
import { ChatActions } from './chat-actions';
import {
  ChatDndProvider,
  dropZoneClassName,
  useChatDndState,
  useChatDraggable,
  useProjectDropZone,
} from './chat-history-dnd';
import { ChatHistorySkeleton } from './chat-history-skeleton';
import { LegalHoldIndicator } from './legal-hold-indicator';

const emptySubscribe = () => () => {};

function useIsMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

interface ChatItem {
  _id: string;
  title: string;
  createdAt: number;
  generationStatus?: 'generating' | 'idle';
  isShared: boolean;
  projectId?: string;
  pinnedAt?: number;
  lastReplyAt?: number;
  lastReadAt?: number;
}

/**
 * Sort comparator: pinned rows float to the top (most-recently-pinned
 * first), unpinned rows keep their incoming recency order. Stable for
 * equal keys so the caller's prior ordering is preserved within each band.
 */
function byPinnedThenRecency(a: ChatItem, b: ChatItem): number {
  if (a.pinnedAt && b.pinnedAt) return b.pinnedAt - a.pinnedAt;
  if (a.pinnedAt) return -1;
  if (b.pinnedAt) return 1;
  return b.createdAt - a.createdAt;
}

// Shared row plumbing — passed via context so chat rows render identically
// whether they live in the flat list or nested inside a project folder,
// without threading a dozen props through every folder.
interface ChatRowContextValue {
  organizationId: string;
  currentThreadId?: string;
  editingChatId: string | null;
  pendingThreadIds: Set<string>;
  executingThreadIds: Set<string>;
  isThreadHeld: (threadId: string) => boolean;
  onSelect: (chatId: string) => void;
  /** Warm the thread route's chunk + loader on hover/focus so the click is
   *  near-instant. Router `defaultPreload: 'intent'` doesn't fire for rows that
   *  navigate imperatively rather than via <Link>, so we preload explicitly. */
  onPreload: (chatId: string) => void;
  onStartRename: (chatId: string) => void;
  onSaveRename: (chatId: string, title: string) => void;
  onCancelRename: () => void;
  onInputBlur: (chatId: string, title: string) => void;
}

const ChatRowContext = createContext<ChatRowContextValue | null>(null);

function useChatRowContext() {
  const ctx = useContext(ChatRowContext);
  if (!ctx) throw new Error('ChatRow must be rendered inside ChatRowContext');
  return ctx;
}

/**
 * Pins a section header to the top of the scrolling list. Opaque background so
 * scrolled rows disappear under it; z-20 clears the rows' own z-10 hover
 * overlays (actions menu, drop hints). The next sticky header slides over the
 * previous one at the section boundary — the classic stacked-sections read.
 */
const STICKY_SECTION_HEADER_CLASS = 'bg-background sticky top-0 z-20';

/**
 * Uppercase section label ("PROJECTS" / "CHATS") with an optional right-aligned
 * action slot. Fixed height so a header with an action button doesn't sit taller
 * than one without.
 */
function SidebarSectionHeader({
  label,
  action,
  className,
}: {
  label: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-7 items-center justify-between gap-1 px-2',
        className,
      )}
    >
      <Text
        as="div"
        variant="caption"
        className="text-muted-foreground/70 text-[11px] font-normal tracking-wider uppercase"
      >
        {label}
      </Text>
      {action}
    </div>
  );
}

interface ChatHistorySidebarProps extends ComponentPropsWithoutRef<'div'> {
  organizationId: string;
  onChatSelect?: () => void;
}

export function ChatHistorySidebar({
  organizationId,
  onChatSelect,
  className,
  ...restProps
}: ChatHistorySidebarProps) {
  const { t } = useT('chat');
  const navigate = useNavigate();
  const router = useRouter();
  const params = useParams({ strict: false });
  // TanStack Router useParams with strict: false returns unknown params — cast required
  const currentThreadId = params.threadId;
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [archivedExpanded, setArchivedExpanded] = usePersistedState(
    'chat-sidebar-archived-expanded',
    false,
  );
  const [collapsedProjects, setCollapsedProjects] = usePersistedState<
    Record<string, boolean>
  >('chat-sidebar-collapsed-projects', {});
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const { setSearchOpen } = useSidebar();
  const isMounted = useIsMounted();
  const { toast } = useToast();

  const teamFilter = useOptionalTeamFilter();
  const selectedTeamId = teamFilter?.selectedTeamId ?? undefined;

  const {
    threads: threadsData,
    isLoadingFirstPage,
    canLoadMore,
    isLoadingMore,
    loadMore,
  } = useThreads({ teamId: selectedTeamId, organizationId });

  const {
    threads: archivedThreadsData,
    canLoadMore: canLoadMoreArchived,
    isLoadingMore: isLoadingMoreArchived,
    loadMore: loadMoreArchived,
  } = useArchivedThreads({ teamId: selectedTeamId, organizationId });

  const { projects, isLoading: isLoadingProjects } =
    useProjects(organizationId);

  const { approvals } = useActiveApprovals(organizationId);

  const { data: heldThreadsData } = useActiveHoldTargetIds({
    organizationId,
    targetType: 'thread',
  });
  // Org-wide hold: every thread in the org is implicitly held; the
  // sidebar shows the lock indicator on every row regardless of
  // explicit per-thread hold matches. Closes round-2 V4 P0 — before
  // the org-cascade fix landed, an org-wide hold was silently invisible
  // at the chat-sidebar surface.
  const orgWideHeld = heldThreadsData?.orgHeld ?? false;
  const heldThreadIds = useMemo(
    () => new Set(heldThreadsData?.targetIds ?? []),
    [heldThreadsData?.targetIds],
  );
  const isThreadHeld = useCallback(
    (threadId: string) => orgWideHeld || heldThreadIds.has(threadId),
    [orgWideHeld, heldThreadIds],
  );

  const { executingThreadIds, pendingThreadIds } = useMemo(() => {
    const executing = new Set<string>();
    const pending = new Set<string>();

    // ── Cross-thread human input detection ──
    //
    // When a workflow runs, two approvals exist on DIFFERENT threads:
    //   1. workflow_run (executing) — on the main chat thread (visible in sidebar)
    //   2. human_input_request (pending) — on a sub-thread (NOT visible in sidebar)
    //
    // They share an execution ID:
    //   - workflow_run stores it at metadata.executionId
    //   - human_input_request stores it at wfExecutionId (top-level)
    //
    // We cross-reference them so the main thread shows "awaiting input" (yellow dot)
    // instead of "running" (spinner) when the workflow is paused for user input.
    const executionToMainThread = new Map<string, string>();

    for (const approval of approvals) {
      if (!approval.threadId) continue;

      if (approval.status === 'executing') {
        executing.add(approval.threadId);

        // Track workflow_run → main thread mapping via metadata.executionId
        if (
          approval.resourceType === 'workflow_run' &&
          approval.metadata?.executionId
        ) {
          executionToMainThread.set(
            String(approval.metadata.executionId),
            approval.threadId,
          );
        }
      } else if (approval.status === 'pending') {
        pending.add(approval.threadId);
      }
    }

    // If a pending human_input_request belongs to a running workflow,
    // mark the workflow's main thread as pending too
    for (const approval of approvals) {
      if (
        approval.status === 'pending' &&
        approval.resourceType === 'human_input_request' &&
        approval.wfExecutionId
      ) {
        const mainThreadId = executionToMainThread.get(approval.wfExecutionId);
        if (mainThreadId) {
          pending.add(mainThreadId);
        }
      }
    }

    return { executingThreadIds: executing, pendingThreadIds: pending };
  }, [approvals]);

  const { mutateAsync: updateThread } = useUpdateThread();

  const chats = useMemo(
    () =>
      threadsData?.map(
        (thread): ChatItem => ({
          _id: thread._id,
          title: thread.title ?? t('history.untitled'),
          createdAt: thread._creationTime,
          generationStatus: thread.generationStatus,
          isShared: thread.isShared ?? false,
          projectId: thread.projectId,
          pinnedAt: thread.pinnedAt,
          lastReplyAt: thread.lastReplyAt,
          lastReadAt: thread.lastReadAt,
        }),
      ),
    [threadsData, t],
  );

  const archivedChats = useMemo(
    () =>
      archivedThreadsData?.map((thread) => ({
        _id: thread._id,
        title: thread.title ?? t('history.untitled'),
        createdAt: thread._creationTime,
      })),
    [archivedThreadsData, t],
  );

  const projectIds = useMemo(
    () => new Set<string>(projects.map((project) => project._id)),
    [projects],
  );

  // Folders own the complete chat list for their project (via listProjectThreads),
  // so the flat list shows only un-projected chats. A chat pointing at a project
  // the caller can't see (e.g. archived) falls back here so it never vanishes.
  const looseChats = useMemo(
    () =>
      (chats ?? [])
        .filter((chat) => !chat.projectId || !projectIds.has(chat.projectId))
        // Pinned chats float to the top of the loaded list; the rest keep
        // their recency order (listThreads already returns newest-first).
        .sort(byPinnedThenRecency),
    [chats, projectIds],
  );

  // Folders read like a file tree — pinned projects float to the top, the
  // rest sorted alphabetically by project name.
  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) => {
        if (a.pinnedAt && b.pinnedAt) return b.pinnedAt - a.pinnedAt;
        if (a.pinnedAt) return -1;
        if (b.pinnedAt) return 1;
        return a.name.localeCompare(b.name, undefined, {
          sensitivity: 'base',
        });
      }),
    [projects],
  );

  const handleChatClick = useCallback(
    (threadId: string) => {
      void navigate({
        to: '/dashboard/$id/chat/$threadId',
        params: { id: organizationId, threadId },
      });
      onChatSelect?.();
    },
    [navigate, organizationId, onChatSelect],
  );

  const handleChatPreload = useCallback(
    (threadId: string) => {
      void router
        .preloadRoute({
          to: '/dashboard/$id/chat/$threadId',
          params: { id: organizationId, threadId },
        })
        .catch((error: unknown) => {
          // Preload is a best-effort warm-up; a failure here must never break
          // the row (the click still navigates normally).
          console.warn('Failed to preload chat route', error);
        });
    },
    [router, organizationId],
  );

  const handleStartRename = useCallback(
    (chatId: string) => setEditingChatId(chatId),
    [],
  );

  const handleSaveRename = useCallback(
    async (chatId: string, rawTitle: string) => {
      const title = rawTitle.trim() || t('history.untitled');
      try {
        await updateThread({ threadId: chatId, title });
        setEditingChatId(null);
      } catch (error) {
        console.error('Failed to rename chat:', error);
        toast({
          title: t('history.toast.renameFailed'),
          variant: 'destructive',
        });
      }
    },
    [updateThread, t, toast],
  );

  const handleCancelRename = useCallback(() => setEditingChatId(null), []);

  const handleInputBlur = useCallback(
    (chatId: string, title: string) => {
      // Guard against a stale blur after Enter/Escape already cleared editing.
      setEditingChatId((current) => {
        if (current === chatId) void handleSaveRename(chatId, title);
        return current;
      });
    },
    [handleSaveRename],
  );

  const rowContext = useMemo<ChatRowContextValue>(
    () => ({
      organizationId,
      currentThreadId,
      editingChatId,
      pendingThreadIds,
      executingThreadIds,
      isThreadHeld,
      onSelect: handleChatClick,
      onPreload: handleChatPreload,
      onStartRename: handleStartRename,
      onSaveRename: (chatId, title) => void handleSaveRename(chatId, title),
      onCancelRename: handleCancelRename,
      onInputBlur: handleInputBlur,
    }),
    [
      organizationId,
      currentThreadId,
      editingChatId,
      pendingThreadIds,
      executingThreadIds,
      isThreadHeld,
      handleChatClick,
      handleChatPreload,
      handleStartRename,
      handleSaveRename,
      handleCancelRename,
      handleInputBlur,
    ],
  );

  const setProjectCollapsed = useCallback(
    (projectId: string, collapsed: boolean) => {
      setCollapsedProjects((prev) => ({ ...prev, [projectId]: collapsed }));
    },
    [setCollapsedProjects],
  );

  // Wait for BOTH async sections (chat threads first page + project folders)
  // before swapping the skeleton for real content — dismissing on threads
  // alone lets project rows pop in after first paint (layout shift, #2544).
  const showSkeleton = !isMounted || isLoadingFirstPage || isLoadingProjects;
  const isEmpty = (chats?.length ?? 0) === 0;

  // Defined once and reused by both the empty-state and populated headers so
  // the "new project" affordance always lives on the right of the PROJECTS
  // header row (and never as a tiny icon floating in the panel header).
  // `-mr-1.5` pulls both header actions onto the same vertical axis as the
  // rows' "..." overlay (size-6 at right-1 → center 16px from the row edge).
  const newProjectButton = (
    <Tooltip content={t('newProject')} side="right" contentClassName="py-1.5">
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setCreateProjectOpen(true)}
        aria-label={t('newProject')}
        className="text-muted-foreground -my-1 -mr-1.5 size-7 shrink-0"
      >
        <FolderPlus className="size-4" />
      </Button>
    </Tooltip>
  );

  // The chat search affordance: one icon on the CHATS header (mirrors the
  // "new project" affordance above) that opens the shared ⌘K palette —
  // there is no second search implementation.
  const searchChatButton = (
    <Tooltip content={t('searchChat')} side="right" contentClassName="py-1.5">
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setSearchOpen(true)}
        aria-label={t('searchChat')}
        className="text-muted-foreground -my-1 -mr-1.5 size-7 shrink-0"
      >
        <Search className="size-4" />
      </Button>
    </Tooltip>
  );

  return (
    <div
      className={cn(
        // Safe-area insets are added on top of the design padding so the
        // sidebar's first row clears the iOS notch and the last row clears
        // the home indicator when this sidebar is mounted inside a
        // full-height mobile Sheet (which passes `p-0`, opting out of the
        // Sheet primitive's own safe-area padding).
        'flex flex-[1_1_0] flex-col overflow-hidden px-2.5 py-3.5',
        'pt-[calc(0.625rem+var(--safe-top))] pb-[calc(0.875rem+var(--safe-bottom))] pl-[calc(0.625rem+var(--safe-left))]',
        className,
      )}
      {...restProps}
    >
      <Stack gap={0} className="min-h-0 flex-1 overflow-y-auto">
        <Stack as="section" gap={0}>
          {showSkeleton ? (
            // Shared with ChatSubPanelPlaceholder (the boot-shell /
            // access-resolving stand-in) so the pre-data panel and this
            // loading state are pixel-identical.
            <ChatHistorySkeleton />
          ) : isEmpty && sortedProjects.length === 0 ? (
            <>
              <SidebarSectionHeader
                label={t('projectsSection')}
                action={newProjectButton}
              />
              <Stack
                gap={1}
                align="center"
                justify="center"
                className="px-6 py-10 text-center"
              >
                <MessageSquareDashedIcon
                  className="text-muted-foreground/60 mb-1 size-8"
                  aria-hidden
                />
                <Text
                  as="div"
                  variant="muted"
                  className="text-foreground font-medium text-nowrap"
                >
                  {t('history.empty')}
                </Text>
                <Text as="div" variant="caption" className="text-nowrap">
                  {t('history.emptySubtitle')}
                </Text>
              </Stack>
            </>
          ) : (
            <ChatRowContext.Provider value={rowContext}>
              <ChatDndProvider>
                <Stack gap={0} className="gap-0.5 pb-2">
                  {/* PROJECTS — always rendered (even empty) so the section
                      never appears/disappears on drag and the "new project"
                      action always has a home. Each folder is a drop target. */}
                  <SidebarSectionHeader
                    label={t('projectsSection')}
                    action={newProjectButton}
                    className={STICKY_SECTION_HEADER_CLASS}
                  />
                  {sortedProjects.map((project) => (
                    <ProjectFolder
                      key={project._id}
                      project={project}
                      organizationId={organizationId}
                      currentThreadId={currentThreadId}
                      explicitCollapsed={collapsedProjects[project._id]}
                      onSetCollapsed={(collapsed) =>
                        setProjectCollapsed(project._id, collapsed)
                      }
                    />
                  ))}

                  {/* CHATS — loose chats not filed under any project. Also a
                      drop target: a chat dragged here (from a project) is moved
                      back out to "Chats". Always rendered so that target exists
                      even when every chat currently lives in a project. */}
                  {/* Divider as its own element (not padding inside the h-7
                      header) so the CHATS header box is pixel-identical to
                      PROJECTS'. Margins account for the list's 2px flex gap:
                      6+2 above the border, 8+2 below = the same 8/10 rhythm
                      as every other section boundary. */}
                  <div
                    aria-hidden
                    className="border-border mt-1.5 mb-2 border-t"
                  />
                  <SidebarSectionHeader
                    label={t('chatsSection')}
                    action={searchChatButton}
                    className={STICKY_SECTION_HEADER_CLASS}
                  />
                  <LooseChatsDropZone hasChats={looseChats.length > 0}>
                    {looseChats.map((chat) => (
                      <ChatRow key={chat._id} chat={chat} />
                    ))}
                  </LooseChatsDropZone>

                  {canLoadMore && (
                    <button
                      type="button"
                      onClick={loadMore}
                      disabled={isLoadingMore}
                      className="text-muted-foreground hover:text-foreground flex h-8 items-center px-2 text-left text-[13px] transition-colors disabled:opacity-50"
                    >
                      {isLoadingMore
                        ? t('history.loadingMore')
                        : t('history.loadMore')}
                    </button>
                  )}
                </Stack>
              </ChatDndProvider>
            </ChatRowContext.Provider>
          )}
        </Stack>
      </Stack>

      {archivedChats && archivedChats.length > 0 && (
        <section className="border-border mt-2 shrink-0 border-t pt-2.5">
          <button
            type="button"
            onClick={() => setArchivedExpanded(!archivedExpanded)}
            aria-expanded={archivedExpanded}
            className="hover:bg-muted/60 hover:text-foreground flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left transition-colors"
          >
            <ChevronDown
              className={cn(
                'size-3.5 shrink-0 transition-transform duration-300 ease-out motion-reduce:transition-none',
                !archivedExpanded && '-rotate-90',
              )}
              aria-hidden
            />
            <Text
              as="span"
              variant="caption"
              className="text-muted-foreground flex flex-1 items-center gap-1.5 text-xs font-medium tracking-wide uppercase"
            >
              {t('archived.title')}
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs leading-none font-medium normal-case">
                {archivedChats.length}
              </span>
            </Text>
          </button>
          <div
            className={cn(
              'grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none',
              archivedExpanded
                ? 'grid-rows-[1fr] opacity-100'
                : 'pointer-events-none grid-rows-[0fr] opacity-0',
            )}
            aria-hidden={!archivedExpanded}
            inert={!archivedExpanded}
          >
            <Stack
              gap={0}
              className="max-h-64 min-h-0 gap-0.5 overflow-y-auto pt-1 pb-2"
            >
              {archivedChats.map((chat) => (
                <Row
                  key={chat._id}
                  gap={2}
                  className="text-muted-foreground group hover:bg-muted/60 hover:text-foreground relative h-8 cursor-pointer rounded-md px-2 text-[13px] transition-colors"
                >
                  <button
                    type="button"
                    aria-label={chat.title}
                    onClick={() => handleChatClick(chat._id)}
                    className="absolute inset-0 cursor-pointer rounded-md"
                  />
                  <span className="pointer-events-none relative z-10 flex h-full flex-1 items-center gap-1.5 truncate text-left leading-snug">
                    {isThreadHeld(chat._id) && (
                      <LegalHoldIndicator
                        organizationId={organizationId}
                        targetType="thread"
                        targetId={chat._id}
                      />
                    )}
                    <span className="truncate">{chat.title}</span>
                  </span>
                  <div className="z-10 shrink-0 opacity-100 transition-opacity md:absolute md:top-1/2 md:right-1 md:-translate-y-1/2 md:opacity-0 md:group-hover:opacity-100 md:has-[[data-state=open]]:opacity-100">
                    <ChatActions
                      chat={{ id: chat._id, title: chat.title }}
                      currentChatId={currentThreadId}
                      organizationId={organizationId}
                      isArchived
                    />
                  </div>
                </Row>
              ))}
              {canLoadMoreArchived && (
                <button
                  type="button"
                  onClick={loadMoreArchived}
                  disabled={isLoadingMoreArchived}
                  className="text-muted-foreground hover:text-foreground flex h-8 items-center px-2 text-left text-[13px] transition-colors disabled:opacity-50"
                >
                  {isLoadingMoreArchived
                    ? t('history.loadingMore')
                    : t('history.loadMore')}
                </button>
              )}
            </Stack>
          </div>
        </section>
      )}

      <ProjectCreateDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        organizationId={organizationId}
        // A freshly created project opens expanded so it's ready to receive
        // chats; the persisted state keeps that across the navigation the
        // dialog performs to the new project page.
        onCreated={(projectId) => setProjectCollapsed(projectId, false)}
      />
    </div>
  );
}

function ProjectFolder({
  project,
  organizationId,
  currentThreadId,
  explicitCollapsed,
  onSetCollapsed,
}: {
  project: ProjectListItem;
  organizationId: string;
  currentThreadId?: string;
  /** Persisted user choice for this folder; `undefined` until toggled. */
  explicitCollapsed?: boolean;
  onSetCollapsed: (collapsed: boolean) => void;
}) {
  const { t } = useT('chat');
  const { toast } = useToast();
  const navigate = useNavigate();
  const { threads } = useProjectThreads(project._id, 'mine');
  const { mutate: setProjectPinned } = useSetProjectPinned();
  const isPinned = !!project.pinnedAt;

  const handleTogglePin = useCallback(() => {
    setProjectPinned(
      { projectId: project._id, pinned: !isPinned },
      {
        onError: (error: unknown) => {
          console.error('Failed to update project pin:', error);
          toast({ title: t('pinFailed'), variant: 'destructive' });
        },
      },
    );
  }, [project._id, isPinned, setProjectPinned, toast, t]);

  // Start a new chat already filed under this project (the chat surface reads
  // the `projectId` search param — same path the project Overview's CTA uses).
  const handleNewChat = useCallback(() => {
    void navigate({
      to: '/dashboard/$id/chat',
      params: { id: organizationId },
      search: { projectId: String(project._id) },
    });
  }, [navigate, organizationId, project._id]);

  const menuItems = useMemo<DropdownMenuGroup[]>(
    () => [
      [
        {
          type: 'item' as const,
          label: t('newChat'),
          icon: SquarePen,
          onClick: handleNewChat,
        },
        {
          type: 'item' as const,
          label: isPinned ? t('unpinProject') : t('pinProject'),
          icon: isPinned ? PinOff : Pin,
          onClick: handleTogglePin,
        },
      ],
    ],
    [isPinned, handleTogglePin, handleNewChat, t],
  );

  const chats = useMemo<ChatItem[]>(
    () =>
      threads
        .filter((thread) => thread.status === 'active')
        .map((thread) => ({
          _id: thread.threadId,
          title: thread.title ?? t('history.untitled'),
          createdAt: thread.updatedAt ?? thread.createdAt,
          generationStatus: thread.generationStatus,
          isShared: thread.isShared ?? false,
          projectId: project._id,
          pinnedAt: thread.pinnedAt,
          lastReplyAt: thread.lastReplyAt,
          lastReadAt: thread.lastReadAt,
        }))
        .sort(byPinnedThenRecency),
    [threads, project._id, t],
  );

  const { setNodeRef, isOver } = useProjectDropZone(project._id);

  const containsCurrentChat = currentThreadId
    ? chats.some((chat) => chat._id === currentThreadId)
    : false;
  // Collapsed by default; the open/closed choice is remembered once the user
  // toggles it. Until then, the folder holding the open chat starts expanded.
  const collapsed = explicitCollapsed ?? !containsCurrentChat;

  // Projects are always shown — even empty ones — so the list doesn't shift
  // when a drag begins and the PROJECTS section stays stable. An empty folder
  // simply shows a "drop here" hint once expanded.

  return (
    <div ref={setNodeRef} className={dropZoneClassName(isOver)}>
      {/* The hover fill lives on the wrapper (not the disclosure button) so
          the row stays highlighted while the pointer is over the "..."
          overlay — a sibling of the button. */}
      <Row
        gap={0}
        className="group hover:bg-muted/60 relative rounded-md transition-colors"
      >
        <button
          type="button"
          onClick={() => onSetCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={project.name}
          className="text-muted-foreground group-hover:text-foreground flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors"
        >
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none',
              collapsed && '-rotate-90',
            )}
            aria-hidden
          />
          <ProjectAvatar
            name={project.name}
            icon={project.icon}
            color={project.color}
            size={16}
            variant="plain"
          />
          <span className="flex-1 truncate text-[13px] leading-snug">
            {project.name}
          </span>
          {isPinned && (
            // Hides on hover (desktop) like the count below — the actions
            // overlay lands on this edge and the pin would show through it.
            <Pin
              className="text-muted-foreground size-3 shrink-0 md:group-hover:opacity-0 md:group-has-[[data-state=open]]:opacity-0"
              aria-label={t('pinned')}
            />
          )}
          {/* Plain count, no chip — omitted entirely for empty folders. Hides
              on hover (desktop) to make room for the actions menu, mirroring
              the chat row's share-icon behavior. */}
          {chats.length > 0 && (
            <span className="text-muted-foreground text-xs leading-5 font-medium tabular-nums md:group-hover:opacity-0 md:group-has-[[data-state=open]]:opacity-0">
              {chats.length}
            </span>
          )}
        </button>
        <div className="z-10 shrink-0 opacity-100 transition-opacity md:absolute md:top-1/2 md:right-1 md:-translate-y-1/2 md:opacity-0 md:group-hover:opacity-100 md:has-[[data-state=open]]:opacity-100">
          <DropdownMenu
            align="end"
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="size-6 p-1"
                aria-label={t('moreActions')}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            }
            items={menuItems}
          />
        </div>
      </Row>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
          collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
        )}
        aria-hidden={collapsed}
        inert={collapsed}
      >
        <div className="min-h-0 overflow-hidden">
          <Stack
            gap={0}
            className="border-border/60 mt-1 ml-3.5 gap-0.5 border-l pl-1.5"
          >
            {chats.length === 0 ? (
              <Text
                as="div"
                variant="caption"
                className="text-muted-foreground/70 px-2 py-1.5 text-nowrap"
              >
                {t('history.dropHereToAdd')}
              </Text>
            ) : (
              chats.map((chat) => <ChatRow key={chat._id} chat={chat} />)
            )}
          </Stack>
        </div>
      </div>
    </div>
  );
}

/**
 * The "Chats" (no-project) section as a drop target. Dropping a chat here moves
 * it out of whatever project it was in. When the flat list is empty, a hint
 * appears while dragging so there's still a visible place to drop.
 */
function LooseChatsDropZone({
  hasChats,
  children,
}: {
  hasChats: boolean;
  children: ReactNode;
}) {
  const { t } = useT('chat');
  const { isDragging } = useChatDndState();
  const { setNodeRef, isOver } = useProjectDropZone(null);

  return (
    <div ref={setNodeRef} className={dropZoneClassName(isOver)}>
      <Stack gap={0} className="gap-0.5">
        {children}
      </Stack>
      {isDragging && !hasChats && (
        <div
          className={cn(
            'text-muted-foreground rounded-md border border-dashed px-2 py-3 text-center text-xs transition-colors',
            isOver ? 'border-primary bg-accent/40' : 'border-border/70',
          )}
        >
          {t('history.dropToChatsHint')}
        </div>
      )}
    </div>
  );
}

function ChatRow({ chat }: { chat: ChatItem }) {
  const { t } = useT('chat');
  const ctx = useChatRowContext();
  const isEditing = ctx.editingChatId === chat._id;
  const isPending = ctx.pendingThreadIds.has(chat._id);
  const isGenerating =
    !isPending &&
    (chat.generationStatus === 'generating' ||
      ctx.executingThreadIds.has(chat._id));
  // "Time since last activity" tracks the most recent AI reply, falling back
  // to the chat's creation time for brand-new threads. Paused while the AI
  // is still generating — the row's `animate-pulse` title already conveys
  // the live state, and ticking against a stale timestamp would be noise.
  const relativeAge = useRelativeNow(chat.lastReplyAt ?? chat.createdAt, {
    paused: isGenerating,
  });
  const isHeld = ctx.isThreadHeld(chat._id);
  // "New response" badge: a generation finished more recently than the owner
  // last read this thread, and it isn't the open / actively-generating one.
  const hasNewResponse =
    chat._id !== ctx.currentThreadId &&
    !isGenerating &&
    !!chat.lastReplyAt &&
    chat.lastReplyAt > (chat.lastReadAt ?? 0);

  const [draft, setDraft] = useState(chat.title);
  const inputRef = useRef<HTMLInputElement>(null);
  // Per-row timer: a single click opens the chat after a short delay, a second
  // click within that window switches the row into inline-rename mode.
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isEditing) {
      setDraft(chat.title);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isEditing, chat.title]);

  const { setNodeRef, listeners, isDragging } = useChatDraggable({
    id: chat._id,
    projectId: chat.projectId ?? null,
    title: chat.title,
    disabled: isEditing,
  });

  return (
    <div
      ref={setNodeRef}
      {...(isEditing ? {} : listeners)}
      data-testid="chat-history-row"
      data-thread-id={chat._id}
      className={cn(
        // Row anatomy mirrors the sidebar nav items: h-8, 13px, muted base
        // text, muted fills — one rhythm from nav to chats.
        'text-muted-foreground group relative flex h-8 items-center gap-2 rounded-md px-2 text-[13px] transition-colors',
        !isEditing && 'hover:bg-muted/60 hover:text-foreground cursor-pointer',
        // Active row highlight — suppressed while THIS row is the drag source
        // so a dragged chat (faded placeholder) is never confused with the
        // selected chat, and its solid fill can't bleed over a drop-zone ring.
        ctx.currentThreadId === chat._id &&
          !isEditing &&
          !isDragging &&
          'bg-muted text-foreground',
        isGenerating && 'animate-pulse',
        isDragging && 'opacity-40',
      )}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              ctx.onSaveRename(chat._id, draft);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              ctx.onCancelRename();
            }
          }}
          onBlur={() => ctx.onInputBlur(chat._id, draft)}
          aria-label={t('history.renameChat')}
          className="ring-primary focus-visible:ring-primary min-w-0 flex-1 rounded-sm bg-transparent px-1 text-base leading-snug ring-1 outline-none focus-visible:ring-2 md:text-[13px]"
        />
      ) : (
        <>
          <button
            type="button"
            aria-label={chat.title}
            onMouseEnter={() => ctx.onPreload(chat._id)}
            onFocus={() => ctx.onPreload(chat._id)}
            onClick={() => {
              if (clickTimeoutRef.current) {
                clearTimeout(clickTimeoutRef.current);
                clickTimeoutRef.current = null;
                ctx.onStartRename(chat._id);
              } else {
                clickTimeoutRef.current = setTimeout(() => {
                  clickTimeoutRef.current = null;
                  ctx.onSelect(chat._id);
                }, 250);
              }
            }}
            className="absolute inset-0 cursor-pointer rounded-md"
          />
          <span className="pointer-events-none relative z-10 flex flex-1 items-center gap-1.5 truncate text-left leading-snug">
            {isPending && (
              <CircleDotIcon
                className="text-warning size-3.5 shrink-0"
                aria-label={t('history.awaitingInput')}
              />
            )}
            {isGenerating && (
              // Blue "generating" dot — a clearer per-row signal than the
              // whole-row pulse alone.
              <span
                className="size-2 shrink-0 animate-pulse rounded-full bg-blue-500 motion-reduce:animate-none dark:bg-blue-400"
                aria-hidden="true"
              />
            )}
            {isHeld && (
              <LegalHoldIndicator
                organizationId={ctx.organizationId}
                targetType="thread"
                targetId={chat._id}
              />
            )}
            {chat.pinnedAt && (
              <Pin
                className="text-muted-foreground size-3 shrink-0"
                aria-label={t('pinned')}
              />
            )}
            <span
              className="truncate"
              aria-label={isGenerating ? t('history.generating') : undefined}
            >
              {chat.title}
            </span>
          </span>
          {chat.isShared && (
            <Share2Icon
              className="text-muted-foreground pointer-events-none relative z-10 size-3 shrink-0 md:group-hover:hidden md:group-has-[[data-state=open]]:hidden"
              aria-label={t('share.sharedIndicator')}
            />
          )}
          {/* Unread "new response" badge — red pill, stays visible on hover
              (it sits left of the actions overlay) until the chat is opened. */}
          {hasNewResponse && (
            <span
              className="text-destructive-foreground pointer-events-none relative z-10 flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] leading-none font-semibold"
              aria-label={t('newResponse')}
            >
              1
            </span>
          )}
          {/* Relative age — visible at rest, hidden on hover where the
              actions menu takes over (desktop). Always hidden on touch since
              the menu is in-flow there. Suppressed when a new-response badge
              is showing so the row doesn't crowd. */}
          {!hasNewResponse && relativeAge !== null && (
            <span className="text-muted-foreground pointer-events-none relative z-10 hidden shrink-0 text-xs tabular-nums md:inline md:group-hover:hidden md:group-has-[[data-state=open]]:hidden">
              {relativeAge}
            </span>
          )}
          {/* On desktop the actions menu is an absolute overlay so it reserves
              no horizontal space until hover — the title gets the full width.
              On touch it stays in-flow and always visible. */}
          <div className="z-10 shrink-0 opacity-100 transition-opacity md:absolute md:top-1/2 md:right-1 md:-translate-y-1/2 md:opacity-0 md:group-hover:opacity-100 md:has-[[data-state=open]]:opacity-100">
            <ChatActions
              chat={{ id: chat._id, title: chat.title }}
              currentChatId={ctx.currentThreadId}
              organizationId={ctx.organizationId}
              onRename={() => ctx.onStartRename(chat._id)}
              isPinned={!!chat.pinnedAt}
              projectId={chat.projectId}
            />
          </div>
        </>
      )}
    </div>
  );
}
