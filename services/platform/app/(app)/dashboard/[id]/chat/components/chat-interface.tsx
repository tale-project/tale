'use client';

import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { ArrowDown, Loader2 } from 'lucide-react';

import { toast } from '@/hooks/use-toast';
import MessageBubble from './message-bubble';
import ChatInput from './chat-input';
import { IntegrationApprovalCard } from './integration-approval-card';
import { cn } from '@/lib/utils/cn';
import { uuidv7 } from 'uuidv7';
import { useThrottledScroll } from '@/hooks/use-throttled-scroll';
import { useQuery, useMutation } from 'convex/react';
import { useUIMessages, type UIMessage } from '@convex-dev/agent/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { useChatLayout, type FileAttachment } from '../layout';
import { sanitizeChatMessage } from '@/lib/utils/sanitize-chat';
import {
  useIntegrationApprovals,
  type IntegrationApproval,
} from '../hooks/use-integration-approvals';

interface ChatInterfaceProps {
  organizationId: string;
  threadId?: string;
}

// File part from UIMessage.parts
interface FilePart {
  type: 'file';
  mediaType: string;
  filename?: string;
  url: string;
}

interface ChatMessage {
  id: string; // Document ID for metadata lookup
  key: string; // React key for rendering (unique per UI element)
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  attachments?: FileAttachment[];
  fileParts?: FilePart[]; // File parts from server messages
  _creationTime?: number; // For chronological ordering with approvals
}

/**
 * Represents a tool invocation with its details extracted from streaming parts.
 */
interface ToolDetail {
  toolName: string;
  displayText: string;
}

/**
 * Extracts a hostname from a URL for display purposes.
 */
function extractHostname(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Truncates a string to a maximum length, adding ellipsis if needed.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '…';
}

/**
 * Formats a tool invocation into a human-readable display text with context.
 * Extracts relevant details from the tool's input arguments.
 */
function formatToolDetail(
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input?: Record<string, any>,
): ToolDetail {
  // Handle web_read tool with operation-specific display
  if (toolName === 'web_read' && input) {
    if (input.operation === 'search' && input.query) {
      return {
        toolName,
        displayText: `Searching "${truncate(input.query, 30)}"`,
      };
    }
    if (input.operation === 'fetch_url' && input.url) {
      return {
        toolName,
        displayText: `Reading ${extractHostname(input.url)}`,
      };
    }
  }

  // Handle rag_search with query
  if (toolName === 'rag_search' && input?.query) {
    return {
      toolName,
      displayText: `Searching knowledge base for "${truncate(input.query, 25)}"`,
    };
  }

  // Default fallback display names for tools without detailed input
  const defaultDisplayNames: Record<string, string> = {
    customer_read: 'Reading customer data',
    product_read: 'Reading product catalog',
    rag_search: 'Searching knowledge base',
    rag_write: 'Updating knowledge base',
    web_read: 'Fetching web content',
    pdf: 'Processing PDF',
    image: 'Analyzing image',
    pptx: 'Processing presentation',
    docx: 'Processing document',
    resource_check: 'Checking resources',
    workflow_read: 'Reading workflow',
    update_workflow_step: 'Updating workflow step',
    save_workflow_definition: 'Saving workflow',
    validate_workflow_definition: 'Validating workflow',
    generate_excel: 'Generating Excel file',
    context_search: 'Searching for related topics',
  };

  const displayText =
    defaultDisplayNames[toolName] ||
    toolName
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

  return { toolName, displayText };
}

interface ThinkingAnimationProps {
  threadId?: string;
  streamingMessage?: UIMessage;
}

function ThinkingAnimation({
  threadId,
  streamingMessage,
}: ThinkingAnimationProps) {
  // Extract tool details from streaming message parts
  // Parts with tool info have type format 'tool-{toolName}' (e.g., 'tool-web_read')
  // and may contain 'input' with the tool's arguments
  const toolDetails: ToolDetail[] = [];

  if (streamingMessage?.parts) {
    for (const part of streamingMessage.parts) {
      // The type format is 'tool-{toolName}', e.g., 'tool-web_read', 'tool-rag_search'
      if (part.type.startsWith('tool-')) {
        // Extract tool name from type (remove 'tool-' prefix)
        const toolName = part.type.slice(5); // 'tool-'.length === 5
        if (toolName && toolName !== 'invocation') {
          // Extract input if available (cast part to access input property)
          const toolPart = part as { input?: Record<string, unknown> };
          const detail = formatToolDetail(toolName, toolPart.input);
          toolDetails.push(detail);
        }
      }
    }
  }

  // Determine what text to display - show tool details or default "Thinking"
  let displayText = 'Thinking';

  if (toolDetails.length === 1) {
    // Single tool - show its detailed display text
    displayText = toolDetails[0].displayText;
  } else if (toolDetails.length > 1) {
    // Multiple tools - deduplicate by display text and join them
    const uniqueDisplayTexts = [
      ...new Set(toolDetails.map((d) => d.displayText)),
    ];

    // Check if all display texts start with the same verb (e.g., "Searching", "Reading")
    // to create a more natural grouped message
    const searchPrefix = 'Searching "';
    const allSearches = uniqueDisplayTexts.every((t) =>
      t.startsWith(searchPrefix),
    );

    if (allSearches && uniqueDisplayTexts.length > 1) {
      // Extract just the query parts (remove "Searching " prefix and closing quote)
      const queries = uniqueDisplayTexts.map((t) =>
        t.slice(searchPrefix.length - 1, t.endsWith('"') ? t.length : t.length),
      );
      if (queries.length <= 2) {
        displayText = `Searching ${queries.join(' and ')}`;
      } else {
        displayText = `Searching ${queries[0]}, ${queries[1]} and ${queries.length - 2} more`;
      }
    } else if (uniqueDisplayTexts.length <= 2) {
      displayText = uniqueDisplayTexts.join(' and ');
    } else {
      // For 3+ different tool calls, show first two and count
      displayText = `${uniqueDisplayTexts[0]}, ${uniqueDisplayTexts[1]} and ${uniqueDisplayTexts.length - 2} more`;
    }
  }

  // Use tool details as key for animation
  const animationKey =
    toolDetails.length > 0
      ? toolDetails.map((d) => d.displayText).join('-')
      : 'thinking';

  return (
    <div className="flex justify-start">
      <motion.div
        key={animationKey}
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
          key={animationKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: 0.2,
            ease: 'easeInOut',
          }}
          className="inline-block"
        >
          {displayText}
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
    isPending,
    setIsPending,
    isLoading,
    clearChatState,
  } = useChatLayout();

  const [inputValue, setInputValue] = useState('');
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Optimistic user message content
  const userDraftMessage = optimisticMessage?.content || '';

  // Fetch thread messages with streaming support
  // Use pagination to handle large threads (50+ messages)
  const {
    results: uiMessages,
    loadMore,
    status: paginationStatus,
  } = useUIMessages(
    api.threads.getThreadMessagesStreaming,
    threadId ? { threadId } : 'skip',
    { initialNumItems: 50, stream: true },
  );

  // Track pagination state for loading more messages
  const canLoadMore = paginationStatus === 'CanLoadMore';
  const isLoadingMore = paginationStatus === 'LoadingMore';

  // Convert UIMessage to ChatMessage format for compatibility
  // Memoize to prevent unnecessary re-renders when typing
  const threadMessages: ChatMessage[] = useMemo(() => {
    return (uiMessages || [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        // Extract file parts (images) from UIMessage.parts
        const fileParts = (m.parts || [])
          .filter((p): p is FilePart => p.type === 'file')
          .map((p) => ({
            type: 'file' as const,
            mediaType: p.mediaType,
            filename: p.filename,
            url: p.url,
          }));

        return {
          // id: document ID for metadata lookup
          // key: React key with step/part suffix for unique rendering
          id: m.id,
          key: m.key,
          content: m.text,
          role: m.role as 'user' | 'assistant',
          timestamp: new Date(m._creationTime),
          fileParts: fileParts.length > 0 ? fileParts : undefined,
          _creationTime: m._creationTime,
        };
      });
  }, [uiMessages]);

  // Find if there's currently a streaming assistant message
  const streamingMessage = uiMessages?.find(
    (m) => m.role === 'assistant' && m.status === 'streaming',
  );

  // Fetch integration approvals for this thread
  const { approvals: integrationApprovals } = useIntegrationApprovals(threadId);

  // Create a merged list of messages and approvals, sorted by creation time
  // This allows approvals to appear inline with messages in chronological order
  type ChatItem =
    | { type: 'message'; data: ChatMessage }
    | { type: 'approval'; data: IntegrationApproval };

  const mergedChatItems = useMemo((): ChatItem[] => {
    const items: ChatItem[] = [];

    // Add messages
    for (const message of threadMessages || []) {
      items.push({ type: 'message', data: message });
    }

    // Filter approvals: hide pending approvals that don't have a messageId yet
    // The messageId is linked after the stream completes in generateAgentResponse
    // This ensures approval cards only appear after the assistant message is fully rendered
    const filteredApprovals = (integrationApprovals || []).filter((approval) => {
      // Always show resolved approvals (approved/rejected)
      if (approval.status !== 'pending') return true;
      // For pending approvals, only show if they have a messageId
      // (meaning the stream that created them has completed)
      return !!approval.messageId;
    });

    // Add filtered approvals
    for (const approval of filteredApprovals) {
      items.push({ type: 'approval', data: approval });
    }

    // Sort by creation time (approvals have _creationTime, messages have _creationTime or timestamp)
    items.sort((a, b) => {
      const timeA =
        a.type === 'message'
          ? a.data._creationTime || a.data.timestamp.getTime()
          : a.data._creationTime;
      const timeB =
        b.type === 'message'
          ? b.data._creationTime || b.data.timestamp.getTime()
          : b.data._creationTime;
      return timeA - timeB;
    });

    return items;
  }, [threadMessages, integrationApprovals]);

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
      uiMessages !== undefined &&
      threadMessages?.some((m) => {
        if (m.role !== 'user') return false;
        // Check for exact match OR if the message starts with the optimistic content
        // (handles case where images are appended as markdown)
        return (
          m.content === optimisticMessage.content ||
          m.content.startsWith(optimisticMessage.content)
        );
      })
    ) {
      setOptimisticMessage(null);
    }
  }, [
    uiMessages,
    threadMessages,
    optimisticMessage?.content,
    setOptimisticMessage,
  ]);

  // Scroll handling
  const containerRef = useRef<HTMLDivElement>(null);
  const aiResponseAreaRef = useRef<HTMLDivElement>(null);
  const { throttledScrollToBottom, cleanup } = useThrottledScroll({
    delay: 16,
  });
  const messageCount = threadMessages?.length ?? 0;

  // Track when we should scroll to position AI response at top
  const shouldScrollToAIRef = useRef(false);

  // Scroll AI response area to top of viewport (with some padding)
  const scrollToAIResponse = useCallback(() => {
    if (aiResponseAreaRef.current && containerRef.current) {
      const container = containerRef.current;
      const aiArea = aiResponseAreaRef.current;
      const containerRect = container.getBoundingClientRect();
      const aiAreaRect = aiArea.getBoundingClientRect();

      // Calculate where to scroll so the AI response starts near the top
      // with some padding (e.g., 80px from top for context)
      const targetScrollTop =
        container.scrollTop + (aiAreaRect.top - containerRect.top) - 80; // 80px padding from top

      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth',
      });
    }
  }, []);

  useEffect(() => {
    // When loading starts (AI response begins), scroll to position it at top
    if (isLoading && shouldScrollToAIRef.current) {
      // Small delay to ensure the thinking animation is rendered
      requestAnimationFrame(() => {
        scrollToAIResponse();
        shouldScrollToAIRef.current = false;
      });
    }
  }, [isLoading, scrollToAIResponse]);

  useEffect(() => {
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
  }, [cleanup]);

  const scrollToBottom = () => {
    if (containerRef.current) {
      throttledScrollToBottom(containerRef.current, 'smooth');
    }
  };

  const handleSendMessage = async (
    message: string,
    attachments?: FileAttachment[],
  ) => {
    const sanitizedContent = sanitizeChatMessage(message);

    const userMessage = {
      id: uuidv7(),
      content: sanitizedContent,
      role: 'user' as const,
      timestamp: Date.now(),
      attachments,
    };

    setOptimisticMessage({ content: sanitizedContent, threadId, attachments });
    setInputValue('');

    // Set pending immediately to show thinking animation right away
    setIsPending(true);

    // Flag to scroll AI response area to top when loading starts
    shouldScrollToAIRef.current = true;

    try {
      let currentThreadId = threadId;
      let isFirstMessage = false;

      // Create thread if needed
      if (!currentThreadId) {
        const title =
          message.length > 50 ? message.substring(0, 50) + '...' : message;
        const newThreadId = await createThread({
          organizationId,
          title,
          chatType: 'general',
        });
        currentThreadId = newThreadId;
        isFirstMessage = true;

        setOptimisticMessage({
          content: sanitizedContent,
          threadId: newThreadId,
          attachments,
        });
        router.push(`/dashboard/${organizationId}/chat/${newThreadId}`, {
          scroll: false,
        });
      } else {
        isFirstMessage = threadMessages?.length === 0;
      }

      // Update thread title for first message
      if (isFirstMessage && currentThreadId) {
        const title =
          message.length > 50 ? message.substring(0, 50) + '...' : message;
        await updateThread({ threadId: currentThreadId, title });
      }

      // Send message and start polling
      // Convert attachments to the format expected by the mutation
      const mutationAttachments = attachments?.map((a) => ({
        fileId: a.fileId,
        fileName: a.fileName,
        fileType: a.fileType,
        fileSize: a.fileSize,
      }));

      const result = await chatWithAgent({
        threadId: currentThreadId,
        organizationId,
        message: userMessage.content,
        attachments: mutationAttachments,
      });

      // Clear pending now that we have a run ID
      setIsPending(false);
      setCurrentRunId(result.runId);
    } catch (error) {
      clearChatState();
      setInputValue('');
      toast({
        title:
          error instanceof Error ? error.message : 'Failed to send message',
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
            // Chat messages and approvals - show when we have a threadId OR messages OR draft
            <div className="max-w-[var(--chat-max-width)] mx-auto space-y-4">
              {/* Load More button for pagination - shows when more messages exist */}
              {(canLoadMore || isLoadingMore) && (
                <div className="flex justify-center py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => loadMore(50)}
                    disabled={isLoadingMore}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {isLoadingMore ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      'Load older messages'
                    )}
                  </Button>
                </div>
              )}
              {/* Render merged messages and approvals in chronological order */}
              {mergedChatItems.map((item) => {
                if (item.type === 'message') {
                  const message = item.data;
                  // Show user messages always, and assistant messages even if empty (for streaming)
                  const shouldShow =
                    message.role === 'user' || message.content !== '';

                  return shouldShow ? (
                    <MessageBubble
                      key={message.key}
                      message={{
                        ...message,
                        threadId: threadId,
                      }}
                    />
                  ) : null;
                } else {
                  // Render approval card
                  const approval = item.data;
                  return (
                    <div
                      key={`approval-${approval._id}`}
                      className="flex justify-start"
                    >
                      <IntegrationApprovalCard
                        approvalId={approval._id}
                        status={approval.status}
                        metadata={approval.metadata}
                        executedAt={approval.executedAt}
                        executionError={approval.executionError}
                      />
                    </div>
                  );
                }
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
                    attachments: optimisticMessage?.attachments,
                  }}
                />
              )}

              {/* AI Response area - ref used for scroll positioning */}
              <div ref={aiResponseAreaRef}>
                {isLoading && (
                  <ThinkingAnimation
                    threadId={threadId}
                    streamingMessage={streamingMessage}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        <ChatInput
          key={threadId || 'new-chat'}
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
