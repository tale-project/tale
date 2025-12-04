'use client';

import { useRef, useEffect, useState } from 'react';
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
    currentRunId,
    setCurrentRunId,
    isLoading,
    clearChatState,
  } = useChatLayout();

  const [inputValue, setInputValue] = useState('');
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Optimistic user message content
  const userDraftMessage = optimisticMessage?.content || '';

  // Fetch thread messages
  const rawThreadMessages = useQuery(
    api.threads.getThreadMessages,
    threadId ? { threadId } : 'skip',
  );
  const threadMessages: ChatMessage[] = (rawThreadMessages?.messages || []).map(
    (m) => ({
      id: m._id,
      content: m.content,
      role: m.role,
      timestamp: m._creationTime,
    }),
  );

  // Query for active runId from thread (for recovery on page refresh)
  const activeRunIdFromThread = useQuery(
    api.threads.getActiveRunId,
    threadId ? { threadId } : 'skip',
  );

  // Poll chat status when we have an active runId
  const chatStatus = useQuery(
    api.chat_agent.chatWithAgentStatus,
    currentRunId ? { runId: currentRunId } : 'skip',
  );

  // Convex mutations
  const createThread = useMutation(api.threads.createChatThread);
  const updateThread = useMutation(api.threads.updateChatThread);
  const chatWithAgent = useMutation(api.chat_agent.chatWithAgent);
  const clearActiveRunIdMutation = useMutation(api.threads.clearActiveRunId);

  // Sync loading state with server and handle chat completion
  useEffect(() => {
    // 1. Recover runId from thread (page refresh/navigation)
    if (!currentRunId && activeRunIdFromThread) {
      setCurrentRunId(activeRunIdFromThread);
      return;
    }

    // 2. Clear stale loading state (AI completed before we could recover)
    if (threadId && activeRunIdFromThread === null && isLoading) {
      clearChatState();
      return;
    }

    // 3. Handle chat status changes
    if (!chatStatus || !currentRunId) return;

    if (chatStatus.status === 'success') {
      clearChatState();
    } else if (chatStatus.status === 'failed') {
      toast({
        title: 'Failed to generate response',
        description: chatStatus.error,
        variant: 'destructive',
      });
      clearActiveRunIdMutation({ threadId: threadId! }).catch(console.error);
      clearChatState();
    } else if (chatStatus.status === 'canceled') {
      clearActiveRunIdMutation({ threadId: threadId! }).catch(console.error);
      clearChatState();
    }
  }, [
    activeRunIdFromThread,
    chatStatus,
    currentRunId,
    threadId,
    isLoading,
    setCurrentRunId,
    clearChatState,
    clearActiveRunIdMutation,
  ]);

  // Clear optimistic message when it appears in actual messages
  useEffect(() => {
    if (
      optimisticMessage?.content &&
      rawThreadMessages !== undefined &&
      threadMessages?.some((m) => m.role === 'user' && m.content === optimisticMessage.content)
    ) {
      setOptimisticMessage(null);
    }
  }, [rawThreadMessages, threadMessages, optimisticMessage?.content, setOptimisticMessage]);

  // Scroll handling
  const containerRef = useRef<HTMLDivElement>(null);
  const { throttledScrollToBottom, cleanup } = useThrottledScroll({ delay: 16 });
  const messageCount = threadMessages?.length ?? 0;

  useEffect(() => {
    // Auto-scroll on new messages
    if (threadId && containerRef.current) {
      throttledScrollToBottom(containerRef.current, 'auto');
    }

    // Setup scroll listener for "scroll to bottom" button
    const container = containerRef.current;
    if (container) {
      const checkScroll = () => {
        const { scrollTop, scrollHeight, clientHeight } = container;
        setShowScrollButton(scrollHeight - scrollTop - clientHeight >= 100);
      };
      container.addEventListener('scroll', checkScroll);
      return () => {
        container.removeEventListener('scroll', checkScroll);
        cleanup();
      };
    }
    return cleanup;
  }, [threadId, messageCount, throttledScrollToBottom, cleanup]);

  const scrollToBottom = () => {
    if (containerRef.current) {
      throttledScrollToBottom(containerRef.current, 'smooth');
    }
  };

  const handleSendMessage = async (message: string, attachments?: FileAttachment[]) => {
    const sanitizedContent = sanitizeChatMessage(message);

    const userMessage = {
      id: uuidv7(),
      content: sanitizedContent,
      role: 'user' as const,
      timestamp: Date.now(),
      attachments,
    };

    setOptimisticMessage({ content: sanitizedContent, threadId });
    setInputValue('');

    try {
      let currentThreadId = threadId;
      let isFirstMessage = false;

      // Create thread if needed
      if (!currentThreadId) {
        const title = message.length > 50 ? message.substring(0, 50) + '...' : message;
        const newThreadId = await createThread({
          organizationId,
          title,
          chatType: 'general',
        });
        currentThreadId = newThreadId;
        isFirstMessage = true;

        setOptimisticMessage({ content: sanitizedContent, threadId: newThreadId });
        router.push(`/dashboard/${organizationId}/chat/${newThreadId}`, { scroll: false });
      } else {
        isFirstMessage = threadMessages?.length === 0;
      }

      // Update thread title for first message
      if (isFirstMessage && currentThreadId) {
        const title = message.length > 50 ? message.substring(0, 50) + '...' : message;
        await updateThread({ threadId: currentThreadId, title });
      }

      // Send message and start polling
      const result = await chatWithAgent({
        threadId: currentThreadId,
        organizationId,
        message: userMessage.content,
      });

      setCurrentRunId(result.runId);
    } catch (error) {
      clearChatState();
      setInputValue('');
      toast({
        title: error instanceof Error ? error.message : 'Failed to send message',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="relative flex flex-col h-full flex-1 min-h-0">
      <div
        ref={containerRef}
        className="flex flex-col h-full flex-1 min-h-0 overflow-y-auto"
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
            <div className="max-w-[var(--chat-max-width)] mx-auto space-y-4">
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
              {isLoading && <ThinkingAnimation />}
            </div>
          )}
        </div>

        <ChatInput
          className="max-w-[var(--chat-max-width)] mx-auto w-full sticky bottom-0 z-50"
          value={inputValue}
          onChange={setInputValue}
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
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
