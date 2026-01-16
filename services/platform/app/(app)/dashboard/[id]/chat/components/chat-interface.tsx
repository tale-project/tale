'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowDown } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { Button } from '@/components/ui/primitives/button';
import { useChatLayout, type FileAttachment } from '../layout';

import { ChatInput } from './chat-input';
import { ChatMessages } from './chat-messages';
import { WelcomeView } from './welcome-view';

import { useMessageProcessing } from '../hooks/use-message-processing';
import { useMergedChatItems } from '../hooks/use-merged-chat-items';
import { useIntegrationApprovals } from '../hooks/use-integration-approvals';
import { useWorkflowCreationApprovals } from '../hooks/use-workflow-creation-approvals';
import { useChatPendingState } from '../hooks/use-chat-pending-state';
import { useSendMessage } from '../hooks/use-send-message';

interface ChatInterfaceProps {
  organizationId: string;
  threadId?: string;
}

export function ChatInterface({
  organizationId,
  threadId,
}: ChatInterfaceProps) {
  const { t } = useT('chat');
  const { isPending, setIsPending, clearChatState } = useChatLayout();

  const [inputValue, setInputValue] = useState('');
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Message processing
  const {
    messages,
    uiMessages,
    loadMore,
    canLoadMore,
    isLoadingMore,
    streamingMessage,
    hasActiveTools,
  } = useMessageProcessing(threadId);

  // Approvals
  const { approvals: integrationApprovals } = useIntegrationApprovals(threadId);
  const { approvals: workflowCreationApprovals } =
    useWorkflowCreationApprovals(threadId);

  // Merge messages with approvals
  const mergedChatItems = useMergedChatItems({
    messages,
    integrationApprovals,
    workflowCreationApprovals,
  });

  // Pending state management - use setPendingWithCount to track assistant message count
  // This enables fallback clearing when streaming detection fails (e.g., first message race condition)
  const { setPendingWithCount } = useChatPendingState({
    isPending,
    setIsPending,
    streamingMessage,
    uiMessages,
  });

  // Loading state
  const isLoading = isPending || !!streamingMessage;

  // Auto-scroll
  const { containerRef, contentRef, scrollToBottom, isAtBottom } =
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

      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth',
      });
    }
  }, [containerRef]);

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

  // Message sending - use setPendingWithCount to enable fallback clearing logic
  const { sendMessage } = useSendMessage({
    organizationId,
    threadId,
    messages,
    setIsPending: setPendingWithCount,
    clearChatState,
    onBeforeSend: () => {
      shouldScrollToAIRef.current = true;
    },
  });

  const handleSendMessage = async (
    message: string,
    attachments?: FileAttachment[],
  ) => {
    setInputValue('');
    await sendMessage(message, attachments);
  };

  // Determine what to show in content area
  const showWelcome = !threadId && messages.length === 0;
  const showMessages = threadId || messages.length > 0;

  return (
    <div className="relative flex flex-col h-full flex-1 min-h-0">
      <div
        ref={containerRef}
        className="flex flex-col h-full flex-1 min-h-0 overflow-y-auto"
      >
        <div
          ref={contentRef}
          className={cn(
            'flex-1 overflow-y-visible p-4 sm:p-8',
            showWelcome && 'flex flex-col items-center justify-end',
          )}
        >
          {showWelcome && <WelcomeView isPending={isPending} />}

          {showMessages && (
            <ChatMessages
              items={mergedChatItems}
              threadId={threadId}
              canLoadMore={canLoadMore}
              isLoadingMore={isLoadingMore}
              loadMore={loadMore}
              isPending={isPending}
              streamingMessage={streamingMessage}
              hasActiveTools={hasActiveTools}
              aiResponseAreaRef={aiResponseAreaRef}
            />
          )}
        </div>

        <div className="sticky bottom-0 z-50">
          {/* Scroll to bottom button */}
          <div className="max-w-(--chat-max-width) mx-auto w-full relative">
            <AnimatePresence>
              {showScrollButton && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.95 }}
                  transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
                  className="absolute -top-10 right-2 sm:right-0 z-10"
                >
                  <Button
                    onClick={scrollToBottom}
                    size="icon"
                    variant="secondary"
                    className="rounded-full shadow-lg backdrop-blur-sm bg-opacity-60"
                    aria-label={t('aria.scrollToBottom')}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <ChatInput
            key={threadId || 'new-chat'}
            className="max-w-(--chat-max-width) mx-auto w-full"
            value={inputValue}
            onChange={setInputValue}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
