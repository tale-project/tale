'use client';

import { m, AnimatePresence } from 'framer-motion';
import { ArrowDown } from 'lucide-react';
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

import type { FileAttachment } from '../types';

import { useChatLayout } from '../context/chat-layout-context';
import {
  useChatAgents,
  useDocumentWriteApprovals,
  useHumanInputRequests,
  useIntegrationApprovals,
  useLocationRequests,
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

  const effectiveAgent = useEffectiveAgent(organizationId);

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
  } = useMessageProcessing(threadId);

  // Merge with pending messages from context for optimistic UI
  const messages = usePendingMessages({
    threadId,
    realMessages: rawMessages,
  });

  // Agent availability — disable input when no agents exist
  const { agents } = useChatAgents(organizationId);
  const hasNoAgents = agents !== undefined && agents.length === 0;

  // Approvals
  const { approvals: integrationApprovals } = useIntegrationApprovals(
    organizationId,
    threadId,
  );
  const { approvals: workflowCreationApprovals } = useWorkflowCreationApprovals(
    organizationId,
    threadId,
  );
  const { approvals: workflowUpdateApprovals } = useWorkflowUpdateApprovals(
    organizationId,
    threadId,
  );
  const { approvals: workflowRunApprovals } = useWorkflowRunApprovals(
    organizationId,
    threadId,
  );
  const { requests: humanInputRequests } = useHumanInputRequests(
    organizationId,
    threadId,
  );
  const { requests: locationRequests } = useLocationRequests(
    organizationId,
    threadId,
  );
  const { approvals: documentWriteApprovals } = useDocumentWriteApprovals(
    organizationId,
    threadId,
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
    threadId ? { threadId } : 'skip',
  );

  // Single derived loading state: "Is the AI turn active?"
  const { isLoading } = useChatLoadingState({
    isPending,
    setIsPending,
    isGenerating: isGenerating ?? false,
    threadId,
    pendingThreadId,
    terminalAssistantCount,
  });

  // Stop generating
  const { stopGenerating, resetCancelled } = useStopGenerating({ threadId });

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
    if (!container || !content) return;

    const onContentChange = () => {
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
    threadId,
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

  // Show messages view when we have content or are loading (to show ThinkingAnimation)
  const showMessages =
    threadId || messages.length > 0 || pendingMessage || isLoading;
  const showWelcome = !showMessages;

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto scroll-smooth"
    >
      <div
        ref={contentRef}
        className={cn(
          'flex flex-col overflow-y-visible p-4 sm:p-8',
          showWelcome && 'flex-1 items-center justify-center',
        )}
      >
        {showWelcome && (
          <WelcomeView
            isPending={isLoading}
            agentName={effectiveAgent?.displayName}
            conversationStarters={effectiveAgent?.conversationStarters}
            onSuggestionClick={setInputValue}
          />
        )}

        {showMessages && (
          <ChatMessages
            items={mergedMessages}
            threadId={threadId}
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
        <FileUpload.Root>
          <ChatInput
            className="mx-auto w-full max-w-(--chat-max-width)"
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
      </PanelFooter>
    </div>
  );
}
