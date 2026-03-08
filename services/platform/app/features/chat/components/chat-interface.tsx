'use client';

import { m, AnimatePresence } from 'framer-motion';
import { ArrowDown } from 'lucide-react';
import { useRef, useEffect, useState, useCallback } from 'react';

import { PanelFooter } from '@/app/components/layout/panel-footer';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Button } from '@/app/components/ui/primitives/button';
import { useAutoScroll } from '@/app/hooks/use-auto-scroll';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { FileAttachment } from '../types';

import { useChatLayout } from '../context/chat-layout-context';
import {
  useChatAgents,
  useHumanInputRequests,
  useIntegrationApprovals,
  useWorkflowCreationApprovals,
  useWorkflowRunApprovals,
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
import { ChatInput } from './chat-input';
import { ChatMessages } from './chat-messages';
import { WelcomeView } from './welcome-view';

function chatDraftKey(threadId?: string) {
  return threadId ? `chat-draft-${threadId}` : 'chat-draft-new';
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
  const {
    isPending,
    setIsPending,
    pendingThreadId,
    setPendingThreadId,
    clearChatState,
    pendingMessage,
    setPendingMessage,
  } = useChatLayout();

  const effectiveAgent = useEffectiveAgent(organizationId);

  const [inputValue, setInputValue, clearInputValue] = usePersistedState(
    chatDraftKey(threadId),
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
  } = useConvexFileUpload();

  usePersistedAttachments({ threadId, attachments, setAttachments });

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
  const { approvals: workflowRunApprovals } = useWorkflowRunApprovals(
    organizationId,
    threadId,
  );
  const { requests: humanInputRequests } = useHumanInputRequests(
    organizationId,
    threadId,
  );

  // Merge messages with approvals and human input requests
  const mergedChatItems = useMergedChatItems({
    messages,
    integrationApprovals,
    workflowCreationApprovals,
    workflowRunApprovals,
    humanInputRequests,
  });

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

  // Auto-scroll
  const { containerRef, contentRef, scrollToBottom, scrollTo, isAtBottom } =
    useAutoScroll({
      enabled: isLoading,
      threshold: 100,
    });

  const aiResponseAreaRef = useRef<HTMLDivElement>(null);
  const shouldScrollToAIRef = useRef(false);

  // Scroll AI response to top of viewport
  const scrollToAIResponse = useCallback(() => {
    if (aiResponseAreaRef.current && containerRef.current) {
      const container = containerRef.current;
      const aiArea = aiResponseAreaRef.current;
      const containerRect = container.getBoundingClientRect();
      const aiAreaRect = aiArea.getBoundingClientRect();

      const targetScrollTop =
        container.scrollTop + (aiAreaRect.top - containerRect.top) - 80;

      scrollTo(Math.max(0, targetScrollTop));
    }
  }, [containerRef, scrollTo]);

  useEffect(() => {
    if (isLoading && shouldScrollToAIRef.current) {
      requestAnimationFrame(() => {
        scrollToAIResponse();
        shouldScrollToAIRef.current = false;
      });
    }
  }, [isLoading, scrollToAIResponse]);

  // Scroll button visibility
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const checkScroll = () => {
      setShowScrollButton(!isAtBottom());
    };

    container.addEventListener('scroll', checkScroll, { passive: true });
    return () => container.removeEventListener('scroll', checkScroll);
  }, [containerRef, isAtBottom]);

  // Scroll to bottom on initial load
  const hasScrolledOnLoadRef = useRef(false);
  useEffect(() => {
    if (
      threadId &&
      messages.length > 0 &&
      !hasScrolledOnLoadRef.current &&
      containerRef.current
    ) {
      hasScrolledOnLoadRef.current = true;
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'instant',
      });
    }
  }, [threadId, messages.length, containerRef]);

  useEffect(() => {
    hasScrolledOnLoadRef.current = false;
  }, [threadId]);

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
      shouldScrollToAIRef.current = true;
    },
    selectedAgent: effectiveAgent,
  });

  const handleSendMessage = async (
    message: string,
    sentAttachments?: FileAttachment[],
  ) => {
    clearInputValue();
    await sendMessage(message, sentAttachments);
  };

  const handleHumanInputResponseSubmitted = useCallback(() => {
    setIsPending(true);
    shouldScrollToAIRef.current = true;
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
      className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto [overflow-anchor:none]"
    >
      <div
        ref={contentRef}
        className={cn(
          'flex-1 overflow-y-visible p-4 sm:p-8',
          showWelcome && 'flex flex-col items-center justify-end',
        )}
      >
        {showWelcome && <WelcomeView isPending={isLoading} />}

        {showMessages && (
          <ChatMessages
            items={mergedChatItems}
            threadId={threadId}
            organizationId={organizationId}
            canLoadMore={canLoadMore}
            isLoadingMore={isLoadingMore}
            loadMore={loadMore}
            activeMessage={activeMessage}
            isLoading={isLoading}
            aiResponseAreaRef={aiResponseAreaRef}
            onHumanInputResponseSubmitted={handleHumanInputResponseSubmitted}
            onSendFollowUp={handleSendFollowUp}
          />
        )}
      </div>

      <PanelFooter>
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
            disabled={hasNoAgents}
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
