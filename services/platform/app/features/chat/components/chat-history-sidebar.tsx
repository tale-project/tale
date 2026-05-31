'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useParams, useNavigate } from '@tanstack/react-router';
import {
  ChevronDown,
  CircleDotIcon,
  FolderPlus,
  MessageSquareDashedIcon,
  MoreHorizontal,
  Pin,
  PinOff,
  Share2Icon,
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
import { useOptionalTeamFilter } from '@/app/hooks/use-team-filter';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { formatRelativeTime } from '@/lib/utils/format/relative-time';

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

interface ChatHistorySidebarProps extends ComponentPropsWithoutRef<'div'> {
  organizationId: string;
  onSearchOpen?: () => void;
  onNewChat?: () => void;
  onChatSelect?: () => void;
}

export function ChatHistorySidebar({
  organizationId,
  onSearchOpen,
  onNewChat,
  onChatSelect,
  className,
  ...restProps
}: ChatHistorySidebarProps) {
  const { t } = useT('chat');
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  // TanStack Router useParams with strict: false returns unknown params — cast required
  const currentThreadId = params.threadId;
  const [isMac, setIsMac] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [archivedExpanded, setArchivedExpanded] = usePersistedState(
    'chat-sidebar-archived-expanded',
    false,
  );
  const [collapsedProjects, setCollapsedProjects] = usePersistedState<
    Record<string, boolean>
  >('chat-sidebar-collapsed-projects', {});
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
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

  const { projects } = useProjects(organizationId);

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

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const platform = (
        navigator.platform ||
        navigator.userAgent ||
        ''
      ).toLowerCase();
      setIsMac(platform.includes('mac'));
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = isMac ? e.metaKey : e.ctrlKey;

      if (isMod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        onSearchOpen?.();
        return;
      }

      if (isMod && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        onNewChat?.();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMac, onSearchOpen, onNewChat]);

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

  const showSkeleton = !isMounted || isLoadingFirstPage;
  const isEmpty = (chats?.length ?? 0) === 0;

  return (
    <div
      className={cn(
        // Safe-area insets are added on top of the design padding so the
        // sidebar's first row clears the iOS notch and the last row clears
        // the home indicator when this sidebar is mounted inside a
        // full-height mobile Sheet (which passes `p-0`, opting out of the
        // Sheet primitive's own safe-area padding).
        'flex flex-[1_1_0] flex-col overflow-hidden px-2.5 py-3.5',
        'pt-[calc(0.875rem+var(--safe-top))] pb-[calc(0.875rem+var(--safe-bottom))] pl-[calc(0.625rem+var(--safe-left))]',
        className,
      )}
      {...restProps}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <section className="flex flex-col">
          <div className="flex items-center justify-between gap-1 px-2 pt-1 pb-2">
            <Text
              as="div"
              variant="caption"
              className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
            >
              {t('chatHistory')}
            </Text>
            <Tooltip
              content={t('newProject')}
              side="bottom"
              contentClassName="py-1.5"
            >
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setCreateProjectOpen(true)}
                aria-label={t('newProject')}
                className="text-muted-foreground size-6 shrink-0"
              >
                <FolderPlus className="size-4" />
              </Button>
            </Tooltip>
          </div>

          {showSkeleton ? (
            <Skeletonize loading>
              <Stack gap={1} className="pb-2">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="flex items-center px-2 py-1.5">
                    <SkeletonBox>
                      <div
                        className="h-3.5"
                        style={{ width: `${78 - (i % 4) * 13}%` }}
                      />
                    </SkeletonBox>
                  </div>
                ))}
              </Stack>
            </Skeletonize>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center">
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
            </div>
          ) : (
            <ChatRowContext.Provider value={rowContext}>
              <ChatDndProvider>
                <Stack gap={1} className="pb-2">
                  {/* Projects render first, visually split from the flat chat
                      list below. The "Projects" / "Chats" group labels only
                      appear when there are projects — otherwise the loose
                      chats sit directly under the panel header with no
                      redundant heading. */}
                  {sortedProjects.length > 0 && (
                    <Text
                      as="div"
                      variant="caption"
                      className="text-muted-foreground px-2 pt-1 text-xs font-medium tracking-wide uppercase"
                    >
                      {t('projectsSection')}
                    </Text>
                  )}
                  {sortedProjects.map((project) => (
                    <ProjectFolder
                      key={project._id}
                      project={project}
                      currentThreadId={currentThreadId}
                      explicitCollapsed={collapsedProjects[project._id]}
                      onSetCollapsed={(collapsed) =>
                        setProjectCollapsed(project._id, collapsed)
                      }
                    />
                  ))}

                  {sortedProjects.length > 0 && looseChats.length > 0 && (
                    <Text
                      as="div"
                      variant="caption"
                      className="border-border text-muted-foreground mt-2 border-t px-2 pt-2.5 text-xs font-medium tracking-wide uppercase"
                    >
                      {t('chatsSection')}
                    </Text>
                  )}
                  <NoProjectDropZone hasChats={looseChats.length > 0}>
                    {looseChats.map((chat) => (
                      <ChatRow key={chat._id} chat={chat} />
                    ))}
                  </NoProjectDropZone>

                  {canLoadMore && (
                    <button
                      type="button"
                      onClick={loadMore}
                      disabled={isLoadingMore}
                      className="text-muted-foreground hover:text-foreground px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-50"
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
        </section>
      </div>

      {archivedChats && archivedChats.length > 0 && (
        <section className="border-border mt-2 shrink-0 border-t pt-2">
          <button
            type="button"
            onClick={() => setArchivedExpanded(!archivedExpanded)}
            aria-expanded={archivedExpanded}
            className="hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors"
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
              gap={1}
              className="max-h-64 min-h-0 overflow-y-auto pt-1 pb-2"
            >
              {archivedChats.map((chat) => (
                <div
                  key={chat._id}
                  className="group hover:bg-accent hover:text-accent-foreground relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
                >
                  <button
                    type="button"
                    aria-label={chat.title}
                    onClick={() => handleChatClick(chat._id)}
                    className="absolute inset-0 cursor-pointer rounded-md"
                  />
                  <span className="text-muted-foreground pointer-events-none relative z-10 flex min-h-[1.5rem] flex-1 items-center gap-1.5 truncate text-left text-sm leading-snug">
                    {isThreadHeld(chat._id) && (
                      <LegalHoldIndicator
                        organizationId={organizationId}
                        targetType="thread"
                        targetId={chat._id}
                      />
                    )}
                    <span className="truncate">{chat.title}</span>
                  </span>
                  <div className="md:bg-accent z-10 shrink-0 opacity-100 transition-opacity md:absolute md:top-1/2 md:right-1 md:-translate-y-1/2 md:rounded-md md:opacity-0 md:group-hover:opacity-100">
                    <ChatActions
                      chat={{ id: chat._id, title: chat.title }}
                      currentChatId={currentThreadId}
                      organizationId={organizationId}
                      isArchived
                    />
                  </div>
                </div>
              ))}
              {canLoadMoreArchived && (
                <button
                  type="button"
                  onClick={loadMoreArchived}
                  disabled={isLoadingMoreArchived}
                  className="text-muted-foreground hover:text-foreground px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-50"
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
  currentThreadId,
  explicitCollapsed,
  onSetCollapsed,
}: {
  project: ProjectListItem;
  currentThreadId?: string;
  /** Persisted user choice for this folder; `undefined` until toggled. */
  explicitCollapsed?: boolean;
  onSetCollapsed: (collapsed: boolean) => void;
}) {
  const { t } = useT('chat');
  const { toast } = useToast();
  const { isDragging } = useChatDndState();
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

  const menuItems = useMemo<DropdownMenuGroup[]>(
    () => [
      [
        {
          type: 'item' as const,
          label: isPinned ? t('unpinProject') : t('pinProject'),
          icon: isPinned ? PinOff : Pin,
          onClick: handleTogglePin,
        },
      ],
    ],
    [isPinned, handleTogglePin, t],
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

  // Empty folders stay hidden to keep the list tidy, but appear while dragging
  // (so a chat can be dropped in) and when explicitly kept open — e.g. a
  // project just created from the button above, before it has any chats.
  if (chats.length === 0 && !isDragging && explicitCollapsed !== false) {
    return null;
  }

  return (
    <div ref={setNodeRef} className={dropZoneClassName(isOver)}>
      <div className="group relative flex items-center">
        <button
          type="button"
          onClick={() => onSetCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={project.name}
          className="hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors"
        >
          <ChevronDown
            className={cn(
              'text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none',
              collapsed && '-rotate-90',
            )}
            aria-hidden
          />
          <ProjectAvatar
            name={project.name}
            icon={project.icon}
            color={project.color}
            size={16}
          />
          <span className="flex-1 truncate text-sm leading-snug font-medium">
            {project.name}
          </span>
          {isPinned && (
            <Pin
              className="text-muted-foreground size-3 shrink-0"
              aria-label={t('pinned')}
            />
          )}
          {/* Count hides on hover (desktop) to make room for the actions
              menu, mirroring the chat row's share-icon behavior. */}
          <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-xs leading-5 font-medium md:group-hover:opacity-0">
            {chats.length}
          </span>
        </button>
        <div className="z-10 shrink-0 opacity-100 transition-opacity md:absolute md:top-1/2 md:right-1 md:-translate-y-1/2 md:opacity-0 md:group-hover:opacity-100">
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
      </div>
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
            gap={1}
            className="border-border/60 mt-1 ml-3.5 border-l pl-1.5"
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

function NoProjectDropZone({
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
    <div ref={setNodeRef} className={dropZoneClassName(isOver && hasChats)}>
      <Stack gap={1}>{children}</Stack>
      {/* When every chat lives in a folder there's no flat list to drop onto,
          so surface an explicit "remove from project" target while dragging. */}
      {isDragging && !hasChats && (
        <div
          className={cn(
            'text-muted-foreground rounded-md border border-dashed px-2 py-3 text-center text-xs transition-colors',
            isOver ? 'border-primary bg-accent/40' : 'border-border/70',
          )}
        >
          {t('history.removeFromProjectHint')}
        </div>
      )}
    </div>
  );
}

function ChatRow({ chat }: { chat: ChatItem }) {
  const { t } = useT('chat');
  const { locale } = useLocale();
  const ctx = useChatRowContext();
  const isEditing = ctx.editingChatId === chat._id;
  const isPending = ctx.pendingThreadIds.has(chat._id);
  const isGenerating =
    !isPending &&
    (chat.generationStatus === 'generating' ||
      ctx.executingThreadIds.has(chat._id));
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
      className={cn(
        'group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        !isEditing &&
          'cursor-pointer hover:bg-accent hover:text-accent-foreground',
        ctx.currentThreadId === chat._id &&
          !isEditing &&
          'bg-accent text-accent-foreground',
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
          className="ring-primary focus-visible:ring-primary min-h-[1.5rem] min-w-0 flex-1 rounded-sm bg-transparent px-1 text-sm leading-snug ring-1 outline-none focus-visible:ring-2"
        />
      ) : (
        <>
          <button
            type="button"
            aria-label={chat.title}
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
          <span className="pointer-events-none relative z-10 flex min-h-[1.5rem] flex-1 items-center gap-1.5 truncate text-left text-sm leading-snug">
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
              className="text-muted-foreground pointer-events-none relative z-10 size-3 shrink-0 md:group-hover:hidden"
              aria-label={t('share.sharedIndicator')}
            />
          )}
          {/* Unread "new response" badge — red pill, stays visible on hover
              (it sits left of the actions overlay) until the chat is opened. */}
          {hasNewResponse && (
            <span
              className="bg-destructive text-destructive-foreground pointer-events-none relative z-10 flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold"
              aria-label={t('newResponse')}
            >
              1
            </span>
          )}
          {/* Relative age — visible at rest, hidden on hover where the
              actions menu takes over (desktop). Always hidden on touch since
              the menu is in-flow there. Suppressed when a new-response badge
              is showing so the row doesn't crowd. */}
          {!hasNewResponse && (
            <span className="text-muted-foreground pointer-events-none relative z-10 hidden shrink-0 text-xs tabular-nums md:inline md:group-hover:hidden">
              {formatRelativeTime(chat.createdAt, locale, 'narrow')}
            </span>
          )}
          {/* On desktop the actions menu is an absolute overlay so it reserves
              no horizontal space until hover — the title gets the full width.
              On touch it stays in-flow and always visible. */}
          <div className="md:bg-accent z-10 shrink-0 opacity-100 transition-opacity md:absolute md:top-1/2 md:right-1 md:-translate-y-1/2 md:rounded-md md:opacity-0 md:group-hover:opacity-100">
            <ChatActions
              chat={{ id: chat._id, title: chat.title }}
              currentChatId={ctx.currentThreadId}
              organizationId={ctx.organizationId}
              onRename={() => ctx.onStartRename(chat._id)}
              isPinned={!!chat.pinnedAt}
            />
          </div>
        </>
      )}
    </div>
  );
}
