'use client';

import { useParams, useNavigate } from '@tanstack/react-router';
import {
  CircleDotIcon,
  Share2Icon,
  ChevronDown,
  MessageSquareDashedIcon,
} from 'lucide-react';
import {
  type ComponentPropsWithoutRef,
  useEffect,
  useState,
  useRef,
  useMemo,
  useSyncExternalStore,
} from 'react';

import { Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useActiveHoldTargetIds } from '@/app/features/settings/governance/hooks/queries';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
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
import { LegalHoldIndicator } from './legal-hold-indicator';

const emptySubscribe = () => () => {};

function useIsMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
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
  const [editValue, setEditValue] = useState('');
  const [archivedExpanded, setArchivedExpanded] = usePersistedState(
    'chat-sidebar-archived-expanded',
    false,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useIsMounted();
  const { toast } = useToast();

  const teamFilter = useOptionalTeamFilter();
  const selectedTeamId = teamFilter?.selectedTeamId ?? undefined;

  const {
    threads: threadsData,
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
  const isThreadHeld = (threadId: string) =>
    orgWideHeld || heldThreadIds.has(threadId);

  const { executingThreadIds, pendingThreadIds } = useMemo(() => {
    const executing = new Set();
    const pending = new Set();

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
    const executionToMainThread = new Map();

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
      threadsData?.map((thread) => ({
        _id: thread._id,
        title: thread.title ?? t('history.untitled'),
        createdAt: thread._creationTime,
        generationStatus: thread.generationStatus,
        isShared: thread.isShared ?? false,
      })),
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

  useEffect(() => {
    if (editingChatId && inputRef.current) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editingChatId]);

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

  const handleChatClick = (threadId: string) => {
    void navigate({
      to: '/dashboard/$id/chat/$threadId',
      params: { id: organizationId, threadId },
    });
    onChatSelect?.();
  };

  const handleStartRename = (chatId: string, currentTitle: string) => {
    setEditingChatId(chatId);
    setEditValue(currentTitle);
  };

  const handleSaveRename = async (chatId: string) => {
    const trimmed = editValue.trim();
    const title = trimmed || t('history.untitled');

    try {
      await updateThread({
        threadId: chatId,
        title,
      });

      setEditingChatId(null);
    } catch (error) {
      console.error('Failed to rename chat:', error);
      toast({
        title: t('history.toast.renameFailed'),
        variant: 'destructive',
      });
    }
  };

  const handleCancelRename = () => {
    setEditingChatId(null);
    setEditValue('');
  };

  const handleInputBlur = (chatId: string) => {
    if (editingChatId === chatId) {
      void handleSaveRename(chatId);
    }
  };

  return (
    <div
      className={cn(
        'flex flex-[1_1_0] flex-col overflow-hidden px-2.5 py-3.5',
        className,
      )}
      {...restProps}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <section className="flex flex-col">
          <Text
            as="div"
            variant="caption"
            className="text-muted-foreground px-2 pt-1 pb-2 text-xs font-medium tracking-wide uppercase"
          >
            {t('chatHistory')}
          </Text>
          <Stack gap={1} className="pb-2">
            {!isMounted || !chats ? (
              <Text as="div" variant="muted" className="px-2 text-nowrap">
                {t('history.loading')}
              </Text>
            ) : chats.length === 0 ? (
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
              <>
                {chats.map((chat) => {
                  const isEditing = editingChatId === chat._id;
                  const isGenerating =
                    !pendingThreadIds.has(chat._id) &&
                    (chat.generationStatus === 'generating' ||
                      executingThreadIds.has(chat._id));

                  return (
                    <div
                      key={chat._id}
                      className={cn(
                        'group relative flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                        !isEditing &&
                          'cursor-pointer hover:bg-accent hover:text-accent-foreground',
                        currentThreadId === chat._id &&
                          !isEditing &&
                          'bg-accent text-accent-foreground',
                        isGenerating && 'animate-pulse',
                      )}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleSaveRename(chat._id);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              handleCancelRename();
                            }
                          }}
                          onBlur={() => handleInputBlur(chat._id)}
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
                                handleStartRename(chat._id, chat.title);
                              } else {
                                clickTimeoutRef.current = setTimeout(() => {
                                  clickTimeoutRef.current = null;
                                  handleChatClick(chat._id);
                                }, 250);
                              }
                            }}
                            className="absolute inset-0 cursor-pointer rounded-md"
                          />
                          <span className="pointer-events-none relative z-10 flex min-h-[1.5rem] flex-1 items-center gap-1.5 truncate text-left text-sm leading-snug">
                            {pendingThreadIds.has(chat._id) && (
                              <CircleDotIcon
                                className="text-warning size-3.5 shrink-0"
                                aria-label={t('history.awaitingInput')}
                              />
                            )}
                            {isThreadHeld(chat._id) && (
                              <LegalHoldIndicator
                                organizationId={organizationId}
                                targetType="thread"
                                targetId={chat._id}
                              />
                            )}
                            <span
                              className="truncate"
                              aria-label={
                                isGenerating
                                  ? t('history.generating')
                                  : undefined
                              }
                            >
                              {chat.title}
                            </span>
                          </span>
                          {chat.isShared && (
                            <Share2Icon
                              className="text-muted-foreground pointer-events-none relative z-10 size-3 shrink-0"
                              aria-label={t('share.sharedIndicator')}
                            />
                          )}
                          <div className="relative z-10 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                            <ChatActions
                              chat={{ id: chat._id, title: chat.title }}
                              currentChatId={currentThreadId}
                              organizationId={organizationId}
                              onRename={() =>
                                handleStartRename(chat._id, chat.title)
                              }
                            />
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
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
              </>
            )}
          </Stack>
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
                    {heldThreadIds.has(chat._id) && (
                      <LegalHoldIndicator
                        organizationId={organizationId}
                        targetType="thread"
                        targetId={chat._id}
                      />
                    )}
                    <span className="truncate">{chat.title}</span>
                  </span>
                  <div className="relative z-10 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
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
    </div>
  );
}
