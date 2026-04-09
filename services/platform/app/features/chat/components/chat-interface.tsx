'use client';

import { m, AnimatePresence } from 'framer-motion';
import { Archive, ArrowDown } from 'lucide-react';
import { useRef, useEffect, useState, useCallback } from 'react';

import { PanelFooter } from '@/app/components/layout/panel-footer';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Button } from '@/app/components/ui/primitives/button';
import { useAutoScroll } from '@/app/hooks/use-auto-scroll';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useBranchContext } from '../context/branch-context';
import { useChatLayout } from '../context/chat-layout-context';
import { useEditAndBranch } from '../hooks/mutations';
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
import { useEffectiveAgent } from '../hooks/use-effective-agent';
import { useMergedChatItems } from '../hooks/use-merged-chat-items';
import { useMessageProcessing } from '../hooks/use-message-processing';
import { usePendingMessages } from '../hooks/use-pending-messages';
import { usePersistedAttachments } from '../hooks/use-persisted-attachments';
import { useSendMessage } from '../hooks/use-send-message';
import { useStopGenerating } from '../hooks/use-stop-generating';
import { useUserContext } from '../hooks/use-user-context';
import type { FileAttachment } from '../types';
import { ChatInput } from './chat-input';
import { ChatMessages } from './chat-messages';
import { EditMessageDialog } from './edit-message-dialog';
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
}

export function ChatInterface({
  organizationId,
  threadId,
}: ChatInterfaceProps) {
  const { t } = useT('chat');
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
  } = useChatLayout();

  const { activeBranchThreadId } = useBranchContext();
  // Use the active branch thread for data loading, but keep URL threadId for drafts/routing
  const dataThreadId = activeBranchThreadId ?? threadId;

  const { agent: effectiveAgent, isLoading: isAgentLoading } =
    useEffectiveAgent(organizationId);

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
  const threadStatus = useThreadStatus(dataThreadId);
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
  }, [containerRef, contentRef, isAtBottom]);

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
    branchScrollSaveRef.current = containerRef.current?.scrollTop ?? null;
    // Clear after content settles
    if (branchScrollTimerRef.current)
      clearTimeout(branchScrollTimerRef.current);
    branchScrollTimerRef.current = setTimeout(() => {
      branchScrollSaveRef.current = null;
      branchScrollTimerRef.current = null;
    }, 2000);
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
      ? selectedModelOverrides[effectiveAgent.name]
      : undefined,
    userContext,
  });

  const handleSendMessage = async (
    message: string,
    sentAttachments?: FileAttachment[],
  ) => {
    scrollingToBottomBehaviorRef.current = 'smooth';
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
      scrollingToBottomBehaviorRef.current = 'smooth';
      void sendMessage(message);
    },
    [sendMessage],
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
        ? selectedModelOverrides[effectiveAgent.name]
        : undefined;

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
      organizationId,
      userContext,
      editAndBranchAction,
      selectNewBranch,
    ],
  );

  // Show messages view when we have content or are loading (to show ThinkingAnimation)
  const showMessages =
    dataThreadId || messages.length > 0 || pendingMessage || isLoading;
  const showWelcome = !showMessages;

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto scroll-smooth will-change-transform"
    >
      <div
        ref={contentRef}
        className={cn(
          'flex flex-col overflow-y-visible p-4 sm:p-6',
          showWelcome && 'flex-1 items-center justify-center',
        )}
      >
        {showWelcome && (
          <WelcomeView
            isPending={isLoading}
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
            onHumanInputResponseSubmitted={handleHumanInputResponseSubmitted}
            onSendFollowUp={handleSendFollowUp}
            onSendMessage={handleSendMessageDirect}
            onEditMessage={handleEditClick}
          />
        )}
      </div>

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
        {isArchived ? (
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
            />
          </FileUpload.Root>
        )}
      </PanelFooter>

      <EditMessageDialog
        open={editingMessage !== null}
        onOpenChange={(open) => {
          if (!open) setEditingMessage(null);
        }}
        messageContent={editingMessage?.content ?? ''}
        onSubmit={handleEditSubmit}
      />
    </div>
  );
}
