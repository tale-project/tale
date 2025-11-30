'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { ArrowDown } from 'lucide-react';

import { toast } from '@/hooks/use-toast';
import MessageBubble from './message-bubble';
import ChatInput from './chat-input';
import { cn } from '@/lib/utils/cn';
import { uuidv7 } from 'uuidv7';
import { useThrottledScroll } from '@/hooks/use-throttled-scroll';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { useChatLayout } from '../layout';
import { sanitizeChatMessage } from '@/lib/utils/sanitize-chat';

interface ChatInterfaceProps {
  organizationId: string;
  threadId?: string;
}

interface FileAttachment {
  fileId: Id<'_storage'>;
  fileName: string;
  fileType: string;
  fileSize: number;
}

interface ChatMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: number;
  attachments?: FileAttachment[];
}

/**
 * Represents the loading state of the chat interface:
 * - false: Not loading
 * - true: Loading (showing thinking animation)
 * - 'streaming': Actively receiving streamed content from AI
 */
type LoadingState = boolean | 'streaming';

// Chat data is now managed via localStorage instead of server calls

function ThinkingAnimation() {
  const [currentStep, setCurrentStep] = useState(0);

  const thinkingSteps = [
    'Thinking',
    'Searching for related topics',
    'Compiling an answer',
  ];

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (currentStep < thinkingSteps.length - 1) {
      interval = setInterval(() => {
        setCurrentStep((prev) => prev + 1);
      }, 2500);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentStep, thinkingSteps.length]);

  return (
    <div className="flex justify-start">
      <motion.div
        key={currentStep}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{
          duration: 0.2,
          ease: 'easeInOut',
        }}
        className="text-sm text-muted-foreground flex items-center gap-2 px-4 py-3"
      >
        <motion.span
          key={currentStep}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: 0.2,
            ease: 'easeInOut',
          }}
          className="inline-block"
        >
          {thinkingSteps[currentStep]}
        </motion.span>
        <div className="flex space-x-1">
          <div className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce" />
          <div
            className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce"
            style={{ animationDelay: '0.1s' }}
          />
          <div
            className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce"
            style={{ animationDelay: '0.2s' }}
          />
        </div>
      </motion.div>
    </div>
  );
}

export default function ChatInterface({
  organizationId,
  threadId,
}: ChatInterfaceProps) {
  const router = useRouter();
  const {
    optimisticMessage,
    setOptimisticMessage,
    isOptimisticLoading,
    setIsOptimisticLoading,
  } = useChatLayout();
  const [isLoading, setIsLoading] = useState<LoadingState>(false);
  const [inputValue, setInputValue] = useState('');
  const [showScrollButton, setShowScrollButton] = useState(false);
  // Track the current run ID for status polling
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  // Use optimistic message from layout (persists across navigation)
  // Show it if: no threadId restriction OR matches current thread OR we're transitioning
  const userDraftMessage = optimisticMessage?.content || '';

  // Convex hooks - always call useQuery unconditionally
  const rawThreadMessages = useQuery(
    api.threads.getThreadMessages,
    threadId ? { threadId } : 'skip',
  );
  // Transform to match expected format (normalize to ChatMessage)
  const threadMessages: ChatMessage[] = (rawThreadMessages?.messages || []).map(
    (m) => ({
      id: m._id,
      content: m.content,
      role: m.role,
      timestamp: m._creationTime,
    }),
  );

  // Query for active runId from thread summary (for recovery on page refresh)
  const activeRunIdFromThread = useQuery(
    api.threads.getActiveRunId,
    threadId ? { threadId } : 'skip',
  );

  // Recover runId from thread on page load (initial mount or when thread changes)
  useEffect(() => {
    // Only recover if we don't already have a runId and the thread has one
    if (!currentRunId && activeRunIdFromThread) {
      setCurrentRunId(activeRunIdFromThread);
      setIsLoading(true);
    }
  }, [activeRunIdFromThread, currentRunId]);

  // Poll chat status when we have an active runId
  const chatStatus = useQuery(
    api.chat_agent.chatWithAgentStatus,
    currentRunId ? { runId: currentRunId } : 'skip',
  );

  // Convex mutations
  const createThread = useMutation(api.threads.createChatThread);
  const updateThread = useMutation(api.threads.updateChatThread);
  // chatWithAgent is now a mutation that kicks off a retried action
  // It returns { runId, messageAlreadyExists } - messages appear via the query
  const chatWithAgent = useMutation(api.chat_agent.chatWithAgent);
  const clearActiveRunIdMutation = useMutation(api.threads.clearActiveRunId);

  // Handle chat completion status changes
  const handleChatComplete = useCallback(
    async (shouldClearActiveRunId = false) => {
      // Clear the activeRunId from thread summary if needed (for failed/canceled cases)
      if (shouldClearActiveRunId && threadId) {
        try {
          await clearActiveRunIdMutation({ threadId });
        } catch (error) {
          console.error('Failed to clear activeRunId:', error);
        }
      }
      setCurrentRunId(null);
      setIsLoading(false);
      setIsOptimisticLoading(false);
      setOptimisticMessage(null);
    },
    [setIsOptimisticLoading, setOptimisticMessage, threadId, clearActiveRunIdMutation],
  );

  // React to chat status changes
  useEffect(() => {
    if (!chatStatus || !currentRunId) return;

    if (chatStatus.status === 'success') {
      // Generation completed successfully - activeRunId cleared server-side in onChatComplete
      handleChatComplete(false);
    } else if (chatStatus.status === 'failed') {
      // Generation failed - clear activeRunId from frontend
      toast({
        title: 'Failed to generate response',
        description: chatStatus.error,
        variant: 'destructive',
      });
      handleChatComplete(true);
    } else if (chatStatus.status === 'canceled') {
      // Generation was canceled - clear activeRunId from frontend
      handleChatComplete(true);
    }
    // 'inProgress' status means we keep polling (useQuery handles this)
  }, [chatStatus, currentRunId, handleChatComplete]);

  const messageCount = threadMessages?.length ?? 0;

  const containerRef = useRef<HTMLDivElement>(null);
  const { throttledScrollToBottom, cleanup } = useThrottledScroll({
    delay: 16,
  });

  useEffect(() => {
    if (!threadId) return;

    if (containerRef.current) {
      throttledScrollToBottom(containerRef.current, 'auto');
    }
  }, [threadId, messageCount, throttledScrollToBottom]);

  // Cleanup throttled scroll on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const scrollToBottom = () => {
    if (containerRef.current) {
      throttledScrollToBottom(containerRef.current, 'smooth');
    }
  };

  // Clear optimistic message when it appears in the actual messages
  useEffect(() => {
    // Don't clear if we don't have a draft or if thread is still loading
    if (!optimisticMessage?.content) return;
    if (threadId && threadMessages === undefined) return; // Query is loading

    // Only clear draft if we found it in the loaded messages
    if (
      threadMessages?.some(
        (m) => m.role === 'user' && m.content === optimisticMessage.content,
      )
    ) {
      setOptimisticMessage(null);
    }
  }, [
    threadId,
    threadMessages?.length,
    optimisticMessage?.content,
    setOptimisticMessage,
  ]);

  const checkScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setShowScrollButton(!isNearBottom);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('scroll', checkScroll);
    return () => {
      container.removeEventListener('scroll', checkScroll);
    };
  }, [threadMessages?.length]);

  // Messages are automatically saved by the Agent Component
  // No need for manual save logic anymore

  const handleSendMessage = async (
    message: string,
    attachments?: FileAttachment[],
  ) => {
    // Sanitize the message content before storing
    const sanitizedContent = sanitizeChatMessage(message);

    const userMessage = {
      id: uuidv7(),
      content: sanitizedContent,
      role: 'user' as const,
      timestamp: new Date().getTime(),
      attachments,
    };

    setOptimisticMessage({ content: sanitizedContent, threadId });
    setIsLoading(true);
    setIsOptimisticLoading(true);
    setInputValue('');

    try {
      let currentThreadId = threadId;
      let isFirstMessage = false;

      // If no thread exists, create one before sending the message
      if (!currentThreadId) {
        // Generate title from first message (truncate to 50 chars)
        const title =
          message.length > 50 ? message.substring(0, 50) + '...' : message;

        const newThreadId = await createThread({
          organizationId: organizationId as string,
          title: title,
          chatType: 'general',
        });
        currentThreadId = newThreadId;
        isFirstMessage = true;

        // Update optimistic message with the new threadId (already sanitized)
        setOptimisticMessage({
          content: sanitizedContent,
          threadId: newThreadId,
        });

        // Navigate to the new thread route with the message in state for seamless transition
        router.push(`/dashboard/${organizationId}/chat/${newThreadId}`, {
          scroll: false,
        });
      } else {
        // Check if this is the first message in an existing thread
        isFirstMessage = threadMessages?.length === 0;
      }

      // If this is the first message, update the thread title
      if (isFirstMessage && currentThreadId) {
        const title =
          message.length > 50 ? message.substring(0, 50) + '...' : message;
        await updateThread({
          threadId: currentThreadId,
          title: title,
        });
      }

      // Call Convex mutation - returns runId for status tracking
      const result = await chatWithAgent({
        threadId: currentThreadId,
        organizationId: organizationId as string,
        message: userMessage.content,
      });

      // Store the runId to start polling for status
      // The useEffect watching chatStatus will handle completion
      setCurrentRunId(result.runId);

      // Metadata is now saved server-side in the onChatComplete callback
      // Messages are automatically saved by Agent Component
      // Loading state will be cleared when chatStatus shows completion
    } catch (error) {
      // Clear loading states on error
      setCurrentRunId(null);
      setOptimisticMessage(null);
      setIsOptimisticLoading(false);
      setIsLoading(false);
      setInputValue(''); // Reset input on error

      const errorMessage =
        error instanceof Error ? error.message : 'Failed to send message';
      toast({
        title: errorMessage,
        variant: 'destructive',
      });
    }
    // Note: No finally block - loading state is managed by chatStatus polling
  };

  return (
    <div className="relative flex flex-col h-full flex-1 min-h-0">
      <div
        ref={containerRef}
        className="flex flex-col h-full flex-1 min-h-0 scrollbar-hide overflow-y-auto"
      >
        {/* Messages area */}
        <div
          className={cn(
            'flex-1 overflow-y-visible p-8',
            !threadId &&
            threadMessages?.length === 0 &&
            !userDraftMessage &&
            'flex flex-col items-center justify-end',
          )}
        >
          {!isLoading &&
            !userDraftMessage &&
            !threadId &&
            threadMessages?.length === 0 && (
              <div className="flex-1 flex items-center justify-center size-full">
                <h1 className="text-[2rem] font-semibold text-center">
                  How can I assist you?
                </h1>
              </div>
            )}
          {(threadId || threadMessages?.length > 0 || userDraftMessage) && (
            // Chat messages - show when we have a threadId OR messages OR draft
            <div className="max-w-[48rem] mx-auto space-y-4">
              {threadMessages?.map((message: ChatMessage) => {
                // Show user messages always, and assistant messages even if empty (for streaming)
                const shouldShow =
                  message.role === 'user' || message.content !== '';

                return shouldShow ? (
                  <MessageBubble
                    key={message.id}
                    message={{
                      ...message,
                      // thread messages are in ms epoch
                      timestamp: new Date(message.timestamp),
                      threadId: threadId,
                    }}
                  />
                ) : null;
              })}
              {userDraftMessage && (
                <MessageBubble
                  key={'user-draft'}
                  message={{
                    id: 'user-draft',
                    content: userDraftMessage,
                    role: 'user',
                    timestamp: new Date(),
                    threadId: threadId,
                  }}
                />
              )}
              {(isLoading || isOptimisticLoading) && <ThinkingAnimation />}
            </div>
          )}
        </div>

        <ChatInput
          className="max-w-[48rem] mx-auto w-full sticky bottom-0"
          value={inputValue}
          onChange={setInputValue}
          onSendMessage={handleSendMessage}
          isLoading={!!isLoading}
        />
      </div>

      {/* Scroll to bottom button */}
      <AnimatePresence>
        {showScrollButton && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-32 left-1/2 -translate-x-1/2 z-10"
          >
            <Button
              onClick={scrollToBottom}
              size="icon"
              variant="secondary"
              className="rounded-full shadow-lg backdrop-blur-sm bg-opacity-60"
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
