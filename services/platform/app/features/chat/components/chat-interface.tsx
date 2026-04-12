'use client';

import { useNavigate } from '@tanstack/react-router';
import { m, AnimatePresence } from 'framer-motion';
import { Archive, ArrowDown, Share, X } from 'lucide-react';
import { useRef, useEffect, useId, useState, useCallback } from 'react';

import { PanelFooter } from '@/app/components/layout/panel-footer';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Button } from '@/app/components/ui/primitives/button';
import { useAutoScroll } from '@/app/hooks/use-auto-scroll';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useOptionalTeamFilter } from '@/app/hooks/use-team-filter';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useMyFeatureFlags } from '../../settings/governance/hooks/queries';
import { useBranchContext } from '../context/branch-context';
import { useChatLayout } from '../context/chat-layout-context';
import { useEditAndBranch, useForkOwnThread } from '../hooks/mutations';
import { useUnarchiveThread } from '../hooks/mutations';
import {
  useChatAgents,
  useDocumentWriteApprovals,
  useHumanInputRequests,
  useIntegrationApprovals,
  useLocationRequests,
  useThreadStatus,
  useWorkflowCreationApprovals,
  useWorkflowRunApprovals,
  useWorkflowUpdateApprovals,
} from '../hooks/queries';
import { useChatLoadingState } from '../hooks/use-chat-loading-state';
import { useConvexFileUpload } from '../hooks/use-convex-file-upload';
import { useDefaultModel } from '../hooks/use-default-model';
import { useEffectiveAgent } from '../hooks/use-effective-agent';
import { useFileIndexingStatus } from '../hooks/use-file-indexing-status';
import { useMergedChatItems } from '../hooks/use-merged-chat-items';
import { useMessageProcessing } from '../hooks/use-message-processing';
import { usePendingMessages } from '../hooks/use-pending-messages';
import { usePersistedAttachments } from '../hooks/use-persisted-attachments';
import { useSendMessage } from '../hooks/use-send-message';
import { useStopGenerating } from '../hooks/use-stop-generating';
import { useUserContext } from '../hooks/use-user-context';
import type { FileAttachment } from '../types';
import { useArenaModeOptional } from './arena/arena-mode-context';
import { ArenaSplitView } from './arena/arena-split-view';
import { ChatInput } from './chat-input';
import { ChatMessages } from './chat-messages';
import { WelcomeView } from './welcome-view';

function chatDraftKey(
  userId: string | undefined,
  organizationId: string,
  threadId?: string,
) {
  const prefix = userId
    ? `chat-draft-${userId}-${organizationId}`
    : `chat-draft-${organizationId}`;
  return threadId ? `${prefix}-${threadId}` : `${prefix}-new`;
}

interface ChatInterfaceProps {
  organizationId: string;
  threadId?: string;
  readOnly?: boolean;
}

export function ChatInterface({
  organizationId,
  threadId,
  readOnly = false,
}: ChatInterfaceProps) {
  const { t } = useT('chat');
  const chatRegionLabelId = useId();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const {
    isPending,
    setIsPending,
    pendingThreadId,
    setPendingThreadId,
    clearChatState,
    pendingMessage,
    setPendingMessage,
    selectedModelOverrides,
    setSelectedModelOverride,
  } = useChatLayout();

  const arenaContext = useArenaModeOptional();

  // Restore arena thread pair when re-enabling arena mode on an existing arena thread
  const isArenaMode = arenaContext?.isArenaMode ?? false;
  const needsArenaRestore =
    isArenaMode && threadId && !arenaContext?.arenaThreadIdA;
  const { data: arenaPair } = useConvexQuery(
    api.threads.queries.getArenaThreadPair,
    needsArenaRestore ? { threadId } : 'skip',
  );
  useEffect(() => {
    if (!arenaContext || arenaContext.arenaThreadIdA) return;
    if (arenaPair) {
      // Existing arena thread — restore both IDs
      arenaContext.setArenaThreadIdA(arenaPair.threadIdA);
      arenaContext.setArenaThreadIdB(arenaPair.threadIdB);
    } else if (isArenaMode && threadId && arenaPair === null) {
      // Non-arena thread — use current thread as A, B will be created on send
      arenaContext.setArenaThreadIdA(threadId);
    }
  }, [arenaPair, arenaContext, isArenaMode, threadId]);

  // Reset arena mode when navigating FROM a thread back to new chat.
  // Track whether we previously had a threadId to avoid disabling
  // arena mode when the user enables it on the new chat page.
  const prevThreadIdRef = useRef(threadId);
  useEffect(() => {
    const hadThread = prevThreadIdRef.current;
    prevThreadIdRef.current = threadId;
    if (hadThread && !threadId && arenaContext?.isArenaMode) {
      arenaContext.disableArenaMode();
    }
  }, [threadId, arenaContext]);

  const { activeBranchThreadId } = useBranchContext();
  // Use the active branch thread for data loading, but keep URL threadId for drafts/routing
  const dataThreadId = activeBranchThreadId ?? threadId;

  const { agent: effectiveAgent, isLoading: isAgentLoading } =
    useEffectiveAgent(organizationId);
  const { data: governanceDefault } = useDefaultModel(organizationId);

  const [inputValue, setInputValue, clearInputValue] = usePersistedState(
    chatDraftKey(user?.userId, organizationId, threadId),
    '',
  );
  const [showScrollButton, setShowScrollButton] = useState(false);

  const {
    attachments,
    setAttachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    clearAttachments,
  } = useConvexFileUpload({ organizationId });

  const { isIndexing, statusMap: indexingStatuses } =
    useFileIndexingStatus(attachments);

  const { data: featureFlags } = useMyFeatureFlags(organizationId);
  const fileUploadDisabled = featureFlags?.fileUpload === false;

  usePersistedAttachments({
    userId: user?.userId,
    threadId,
    attachments,
    setAttachments,
  });

  // Message processing
  const {
    messages: rawMessages,
    loadMore,
    canLoadMore,
    isLoadingMore,
    activeMessage,
    terminalAssistantCount,
  } = useMessageProcessing(dataThreadId);

  // Merge with pending messages from context for optimistic UI
  const messages = usePendingMessages({
    threadId: dataThreadId,
    realMessages: rawMessages,
  });

  // Agent availability — disable input when no agents exist
  const { agents } = useChatAgents(organizationId);
  const hasNoAgents = agents !== undefined && agents.length === 0;

  // Thread status — disable input for archived threads
  // Always check the URL threadId (root thread), not dataThreadId (which may
  // be a branch thread that wasn't individually archived).
  const threadStatus = useThreadStatus(threadId);
  const isArchived = threadStatus === 'archived';

  const { mutate: unarchiveThread, isPending: isUnarchiving } =
    useUnarchiveThread();

  // Approvals
  const { approvals: integrationApprovals } = useIntegrationApprovals(
    organizationId,
    dataThreadId,
  );
  const { approvals: workflowCreationApprovals } = useWorkflowCreationApprovals(
    organizationId,
    dataThreadId,
  );
  const { approvals: workflowUpdateApprovals } = useWorkflowUpdateApprovals(
    organizationId,
    dataThreadId,
  );
  const { approvals: workflowRunApprovals } = useWorkflowRunApprovals(
    organizationId,
    dataThreadId,
  );
  const { requests: humanInputRequests } = useHumanInputRequests(
    organizationId,
    dataThreadId,
  );
  const { requests: locationRequests } = useLocationRequests(
    organizationId,
    dataThreadId,
  );
  const { approvals: documentWriteApprovals } = useDocumentWriteApprovals(
    organizationId,
    dataThreadId,
  );

  // Merge messages with approvals and human input requests
  const { messages: mergedMessages, activeApproval } = useMergedChatItems({
    messages,
    integrationApprovals,
    workflowCreationApprovals,
    workflowUpdateApprovals,
    workflowRunApprovals,
    humanInputRequests,
    locationRequests,
    documentWriteApprovals,
  });

  // Block input when any pending or executing approval exists
  const hasActiveApproval = activeApproval !== null;

  // Fork info — for showing divider in forked threads
  const { data: forkInfo } = useConvexQuery(
    api.threads.queries.getThreadForkInfo,
    dataThreadId ? { threadId: dataThreadId } : 'skip',
  );

  // Server-derived generation status (reactive Convex subscription)
  const { data: isGenerating } = useConvexQuery(
    api.threads.queries.isThreadGenerating,
    dataThreadId ? { threadId: dataThreadId } : 'skip',
  );

  // Single derived loading state: "Is the AI turn active?"
  const { isLoading } = useChatLoadingState({
    isPending,
    setIsPending,
    isGenerating: isGenerating ?? false,
    threadId: dataThreadId,
    pendingThreadId,
    terminalAssistantCount,
  });

  // Stop generating
  const { stopGenerating, resetCancelled } = useStopGenerating({
    threadId: dataThreadId,
  });

  // Auto-clear freeze when loading ends — covers mutation failure, thread
  // navigation, and natural completion without needing explicit .catch()
  useEffect(() => {
    if (!isLoading) {
      resetCancelled();
    }
  }, [isLoading, resetCancelled]);

  // Auto-switch model selector after a successful fallback.
  // Watches messages reactively: when a [MODEL_FALLBACK] "retrying with X"
  // message is followed by a successful assistant response, update the
  // selector so future messages use the working model.
  const lastProcessedFallbackRef = useRef<string | null>(null);
  useEffect(() => {
    if (!effectiveAgent?.name || !messages.length) return;

    // Find the latest MODEL_FALLBACK "retrying with" message
    const fallbackMsg = messages
      .toReversed()
      .find(
        (msg) =>
          msg.role === 'system' &&
          msg.content?.includes('[MODEL_FALLBACK]') &&
          msg.content?.includes('retrying with'),
      );
    if (
      !fallbackMsg?.content ||
      fallbackMsg.id === lastProcessedFallbackRef.current
    )
      return;

    // Only switch after a successful assistant message appears after the fallback
    const fallbackIdx = messages.findIndex((msg) => msg.id === fallbackMsg.id);
    const hasSuccessAfter = messages
      .slice(fallbackIdx + 1)
      .some((msg) => msg.role === 'assistant');
    if (!hasSuccessAfter) return;

    lastProcessedFallbackRef.current = fallbackMsg.id;

    // Extract target model: "X failed — retrying with <model>."
    // Greedy match up to the trailing period to handle dots in model
    // names (e.g. "moonshotai/kimi-k2.5").
    const match = fallbackMsg.content.match(/retrying with (.+)\./);
    if (!match) return;

    const successfulModel = match[1];
    const currentSelected = selectedModelOverrides[effectiveAgent.name];
    if (successfulModel && successfulModel !== currentSelected) {
      setSelectedModelOverride(effectiveAgent.name, successfulModel);
    }
  }, [
    messages,
    effectiveAgent?.name,
    selectedModelOverrides,
    setSelectedModelOverride,
  ]);

  // Scroll utility (no auto-follow — ChatGPT-style)
  const { containerRef, contentRef, scrollToBottom, isAtBottom } =
    useAutoScroll({ threshold: 100 });

  const lastUserMessageRef = useRef<HTMLDivElement>(null);

  // Scroll intent ref: 'smooth' on send, 'instant' on thread init, null when idle.
  const scrollingToBottomBehaviorRef = useRef<ScrollBehavior | null>(null);

  // Scroll + resize handler — handles intentional scrolls and scroll button visibility.
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return undefined;

    const onContentChange = () => {
      // During branch switch: override all scroll behavior with saved position
      if (branchScrollSaveRef.current !== null) {
        container.scrollTop = branchScrollSaveRef.current;
        setShowScrollButton(!isAtBottom());
        return;
      }
      const scrollBehavior = scrollingToBottomBehaviorRef.current;
      if (scrollBehavior) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: scrollBehavior,
        });
      } else if (isAtBottom()) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'instant',
        });
      }
      setShowScrollButton(!isAtBottom());
    };

    const onScroll = () => {
      if (scrollingToBottomBehaviorRef.current && isAtBottom()) {
        scrollingToBottomBehaviorRef.current = null;
      }
      setShowScrollButton(!isAtBottom());
    };

    const resizeObserver = new ResizeObserver(onContentChange);
    resizeObserver.observe(content);

    const mutationObserver = new MutationObserver((mutations) => {
      const hasRelevant = mutations.some(
        (mut) => mut.type !== 'attributes' || mut.attributeName !== 'style',
      );
      if (hasRelevant) onContentChange();
    });
    mutationObserver.observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    container.addEventListener('scroll', onScroll, { passive: true });
    onContentChange();

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      container.removeEventListener('scroll', onScroll);
    };
  }, [containerRef, contentRef, isAtBottom, arenaContext?.isArenaMode]);

  // Scroll to bottom on thread initial load.
  const scrolledForThreadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!threadId || messages.length === 0) return;
    if (scrolledForThreadRef.current === threadId) return;

    scrolledForThreadRef.current = threadId;
    scrollingToBottomBehaviorRef.current = 'instant';

    containerRef.current?.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior: 'instant',
    });
  }, [threadId, messages.length, containerRef]);

  // Preserve scroll position during branch switches.
  // Save scrollTop synchronously during render when dataThreadId changes.
  // The saved value is kept and restored on every onContentChange call
  // until cleared by a timeout (to handle multiple ResizeObserver fires).
  const branchScrollSaveRef = useRef<number | null>(null);
  const branchScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const prevDataThreadIdRef = useRef(dataThreadId);
  if (
    prevDataThreadIdRef.current !== dataThreadId &&
    prevDataThreadIdRef.current !== undefined
  ) {
    // Skip scroll preservation for edit-and-branch — we want scroll-to-bottom
    // so the edited message and incoming AI response are visible.
    if (!pendingMessage?.editedMessageId) {
      branchScrollSaveRef.current = containerRef.current?.scrollTop ?? null;
      // Clear after content settles
      if (branchScrollTimerRef.current)
        clearTimeout(branchScrollTimerRef.current);
      branchScrollTimerRef.current = setTimeout(() => {
        branchScrollSaveRef.current = null;
        branchScrollTimerRef.current = null;
      }, 2000);
    } else {
      // Clear any stale scroll position from a prior branch switch so
      // onContentChange doesn't override the intended scroll-to-bottom.
      branchScrollSaveRef.current = null;
      if (branchScrollTimerRef.current) {
        clearTimeout(branchScrollTimerRef.current);
        branchScrollTimerRef.current = null;
      }
    }
  }
  prevDataThreadIdRef.current = dataThreadId;

  // Load-more scroll preservation: keep viewport stable when older messages prepend
  const handleLoadMore = useCallback(
    (count: number) => {
      const container = containerRef.current;
      if (!container) {
        loadMore(count);
        return;
      }

      const prevScrollHeight = container.scrollHeight;
      const observer = new MutationObserver(() => {
        observer.disconnect();
        container.scrollTop += container.scrollHeight - prevScrollHeight;
      });
      observer.observe(container, { childList: true, subtree: true });
      loadMore(count);

      // Safety timeout to disconnect if no mutation fires
      setTimeout(() => observer.disconnect(), 2000);
    },
    [containerRef, loadMore],
  );

  const userContext = useUserContext();
  const teamFilter = useOptionalTeamFilter();

  const { sendMessage } = useSendMessage({
    organizationId,
    threadId: dataThreadId,
    messages: rawMessages,
    setIsPending: setIsPending,
    setPendingThreadId,
    setPendingMessage,
    clearChatState,
    onBeforeSend: () => {
      resetCancelled();
    },
    selectedAgent: effectiveAgent,
    modelId: effectiveAgent?.name
      ? (selectedModelOverrides[effectiveAgent.name] ??
        governanceDefault?.modelId)
      : undefined,
    userContext,
    arena: arenaContext ?? undefined,
    teamId: teamFilter?.selectedTeamId ?? undefined,
  });

  const handleSendMessage = async (
    message: string,
    sentAttachments?: FileAttachment[],
  ) => {
    // Instant for new threads (no content to scroll past, avoids layout shift
    // during the budget-banner → thread transition). Smooth for existing threads.
    scrollingToBottomBehaviorRef.current = threadId ? 'smooth' : 'instant';
    clearInputValue();
    await sendMessage(message, sentAttachments);
  };

  const handleHumanInputResponseSubmitted = useCallback(() => {
    setIsPending(true);
  }, [setIsPending]);

  const handleSendFollowUp = useCallback(
    (message: string) => {
      setInputValue(message);
    },
    [setInputValue],
  );

  const handleSendMessageDirect = useCallback(
    (message: string) => {
      scrollingToBottomBehaviorRef.current = threadId ? 'smooth' : 'instant';
      void sendMessage(message);
    },
    [sendMessage, threadId],
  );

  // Edit message → open dialog → create branch on submit
  const { selectNewBranch, rootThreadId } = useBranchContext();
  const { mutateAsync: editAndBranchAction } = useEditAndBranch();

  const [editingMessage, setEditingMessage] = useState<{
    id: string;
    content: string;
  } | null>(null);

  const handleEditClick = useCallback((messageId: string, content: string) => {
    setEditingMessage({ id: messageId, content });
  }, []);

  const handleEditSubmit = useCallback(
    async (newContent: string) => {
      if (!editingMessage || !dataThreadId || !effectiveAgent) return;
      const modelId = effectiveAgent.name
        ? (selectedModelOverrides[effectiveAgent.name] ??
          governanceDefault?.modelId)
        : undefined;

      // Optimistic: show edited content immediately, truncate messages after it.
      // Cleared by usePendingMessages when dataThreadId changes (branch loads).
      setPendingMessage({
        content: newContent,
        threadId: dataThreadId,
        timestamp: new Date(),
        editedMessageId: editingMessage.id,
      });

      // Close inline editor so the optimistic content is visible
      setEditingMessage(null);

      // Scroll to bottom so the edited message + incoming AI response are visible
      scrollingToBottomBehaviorRef.current = 'smooth';

      const result = await editAndBranchAction({
        sourceThreadId: dataThreadId,
        rootThreadId: rootThreadId ?? dataThreadId,
        editedMessageId: editingMessage.id,
        newMessage: newContent,
        organizationId,
        orgSlug: 'default',
        agentSlug: effectiveAgent.name,
        modelId,
        userContext,
      });
      selectNewBranch(String(result.forkOrder), result.branchThreadId);
    },
    [
      editingMessage,
      dataThreadId,
      rootThreadId,
      effectiveAgent,
      selectedModelOverrides,
      governanceDefault,
      organizationId,
      userContext,
      editAndBranchAction,
      selectNewBranch,
      setPendingMessage,
    ],
  );

  // Fork at message — create a new thread with messages up to the selected one
  const { mutate: forkOwnThread } = useForkOwnThread();

  const handleForkAtMessage = useCallback(
    (messageId: string) => {
      if (!dataThreadId) return;

      const msg = rawMessages.find((rm) => rm.id === messageId);
      if (msg?.order === undefined) return;

      forkOwnThread(
        { threadId: dataThreadId, upToMessageOrder: msg.order },
        {
          onSuccess: (newThreadId) => {
            void navigate({
              to: '/dashboard/$id/chat/$threadId',
              params: { id: organizationId, threadId: newThreadId },
            });
            toast({ title: t('forkSuccess'), variant: 'success' });
          },
          onError: (error) => {
            console.error('Failed to fork chat:', error);
            toast({ title: t('forkFailed'), variant: 'destructive' });
          },
        },
      );
    },
    [
      dataThreadId,
      rawMessages,
      organizationId,
      forkOwnThread,
      navigate,
      toast,
      t,
    ],
  );

  const handleRetry = useCallback(() => {
    const lastUserMessage = messages
      .toReversed()
      .find((msg) => msg.role === 'user');
    if (!lastUserMessage?.content) return;
    scrollingToBottomBehaviorRef.current = 'smooth';
    void sendMessage(lastUserMessage.content);
  }, [messages, sendMessage]);

  const showArena = arenaContext?.isArenaMode && !!arenaContext.arenaThreadIdA;

  // In arena mode, while waiting for thread creation (isPending but no arena
  // threads yet), don't let isLoading alone trigger the messages view.
  // This keeps the welcome page visible with just the send button loading.
  const arenaWaiting = arenaContext?.isArenaMode && isPending && !showArena;

  // Show messages view when we have content or are loading (to show ThinkingAnimation)
  const showMessages =
    dataThreadId ||
    messages.length > 0 ||
    pendingMessage ||
    (isLoading && !arenaWaiting);
  const showWelcome = !showMessages && !showArena;

  return (
    <div
      ref={containerRef}
      role="region"
      aria-labelledby={chatRegionLabelId}
      className={cn(
        'flex h-full min-h-0 flex-1 flex-col',
        !showArena && 'overflow-y-auto scroll-smooth will-change-transform',
      )}
    >
      <h2 id={chatRegionLabelId} className="sr-only">
        {t('aria.chatRegion')}
      </h2>
      {showArena ? (
        <ArenaSplitView organizationId={organizationId} />
      ) : (
        <div
          ref={contentRef}
          className={cn(
            'flex flex-col overflow-y-visible p-4 sm:p-6',
            showWelcome && 'flex-1 items-center justify-center',
          )}
        >
          {showWelcome && (
            <WelcomeView
              isAgentLoading={isAgentLoading}
              agentName={effectiveAgent?.displayName}
              conversationStarters={effectiveAgent?.conversationStarters}
              onSuggestionClick={setInputValue}
            />
          )}

          {showMessages && (
            <ChatMessages
              items={mergedMessages}
              threadId={dataThreadId}
              organizationId={organizationId}
              canLoadMore={canLoadMore}
              isLoadingMore={isLoadingMore}
              loadMore={handleLoadMore}
              activeMessage={activeMessage}
              isLoading={isLoading}
              lastUserMessageRef={lastUserMessageRef}
              containerRef={containerRef}
              activeApproval={activeApproval}
              forkedMessageCount={forkInfo?.forkedMessageCount ?? undefined}
              lastForkedMessageOrder={
                forkInfo?.lastForkedMessageOrder ?? undefined
              }
              forkedAt={forkInfo?.forkedAt ?? undefined}
              forkedFromShare={forkInfo?.forkedFromShare}
              onHumanInputResponseSubmitted={handleHumanInputResponseSubmitted}
              onSendFollowUp={
                isArchived || readOnly ? undefined : handleSendFollowUp
              }
              onSendMessage={
                isArchived || readOnly ? undefined : handleSendMessageDirect
              }
              onEditMessage={
                isArchived || readOnly ? undefined : handleEditClick
              }
              onForkAtMessage={
                isArchived || readOnly ? undefined : handleForkAtMessage
              }
              onRetry={isArchived || readOnly ? undefined : handleRetry}
              editingMessageId={
                isArchived || readOnly ? undefined : editingMessage?.id
              }
              editingMessageContent={
                isArchived || readOnly ? undefined : editingMessage?.content
              }
              onEditSubmit={
                isArchived || readOnly ? undefined : handleEditSubmit
              }
              onEditCancel={
                isArchived || readOnly
                  ? undefined
                  : () => setEditingMessage(null)
              }
              hideFeedback={isArchived}
            />
          )}
        </div>
      )}

      <PanelFooter className="mt-auto">
        <div className="relative mx-auto w-full max-w-(--chat-max-width)">
          <AnimatePresence>
            {showScrollButton && (
              <m.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
                className="absolute -top-10 right-2 z-10 sm:right-0"
              >
                <Button
                  onClick={scrollToBottom}
                  size="icon"
                  variant="secondary"
                  className="bg-opacity-60 rounded-full shadow-lg backdrop-blur-sm"
                  aria-label={t('aria.scrollToBottom')}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </m.div>
            )}
          </AnimatePresence>
        </div>
        {readOnly ? (
          <div className="border-border bg-muted/50 flex items-center justify-center gap-2 border-t px-3 py-3">
            <Share className="text-muted-foreground size-4" />
            <span className="text-muted-foreground text-sm">
              {t('share.readOnlyBanner')}
            </span>
          </div>
        ) : isArchived ? (
          <div className="border-border bg-muted/50 flex items-center justify-center gap-2 border-t px-3 py-3">
            <Archive className="text-muted-foreground size-4" />
            <span className="text-muted-foreground text-sm">
              {t('archivedBanner')}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={isUnarchiving}
              onClick={() => {
                if (threadId) {
                  unarchiveThread({ threadId });
                }
              }}
            >
              {t('unarchive')}
            </Button>
          </div>
        ) : (
          <FileUpload.Root>
            <ChatInput
              className="mx-auto w-full max-w-(--chat-max-width)"
              placeholder={t('placeholder')}
              value={inputValue}
              onChange={setInputValue}
              onSendMessage={handleSendMessage}
              onStopGenerating={stopGenerating}
              isLoading={isLoading}
              disabled={hasNoAgents || hasActiveApproval}
              disabledReason={
                hasNoAgents
                  ? 'no-agents'
                  : hasActiveApproval
                    ? 'pending-approval'
                    : undefined
              }
              organizationId={organizationId}
              attachments={attachments}
              uploadingFiles={uploadingFiles}
              uploadFiles={uploadFiles}
              removeAttachment={removeAttachment}
              clearAttachments={clearAttachments}
              fileUploadDisabled={fileUploadDisabled}
              isIndexing={isIndexing}
              indexingStatuses={indexingStatuses}
            />
          </FileUpload.Root>
        )}
      </PanelFooter>
    </div>
  );
}
