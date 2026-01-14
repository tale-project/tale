'use client';

import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { ArrowDown, Loader2 } from 'lucide-react';

import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { MessageBubble } from './message-bubble';
import { ChatInput } from './chat-input';
import { IntegrationApprovalCard } from './integration-approval-card';
import { WorkflowCreationApprovalCard } from './workflow-creation-approval-card';
import { cn } from '@/lib/utils/cn';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { useUIMessages, type UIMessage } from '@convex-dev/agent/react';
import { api } from '@/convex/_generated/api';
import { useCreateThread } from '../hooks/use-create-thread';
import { useUpdateThread } from '../hooks/use-update-thread';
import { useChatWithAgent } from '../hooks/use-chat-with-agent';
import { Button } from '@/components/ui/primitives/button';
import { useChatLayout, type FileAttachment } from '../layout';
import { sanitizeChatMessage } from '@/lib/utils/sanitize-chat';
import {
  useIntegrationApprovals,
  type IntegrationApproval,
} from '../hooks/use-integration-approvals';
import {
  useWorkflowCreationApprovals,
  type WorkflowCreationApproval,
} from '../hooks/use-workflow-creation-approvals';

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
  isStreaming?: boolean; // Whether this message is currently streaming
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

interface ThinkingAnimationProps {
  threadId?: string;
  streamingMessage?: UIMessage;
}

function ThinkingAnimation({
  threadId: _threadId,
  streamingMessage,
}: ThinkingAnimationProps) {
  const { t } = useT('chat');

  /**
   * Formats a tool invocation into a human-readable display text with context.
   * Extracts relevant details from the tool's input arguments.
   */
  const formatToolDetail = (
    toolName: string,
    input?: Record<string, unknown>,
  ): ToolDetail => {
    // Handle web_read tool with operation-specific display
    if (toolName === 'web_read' && input) {
      if (input.operation === 'search' && input.query) {
        return {
          toolName,
          displayText: t('thinking.searching', {
            query: truncate(String(input.query), 30),
          }),
        };
      }
      if (input.operation === 'fetch_url' && input.url) {
        return {
          toolName,
          displayText: t('thinking.reading', {
            hostname: extractHostname(String(input.url)),
          }),
        };
      }
    }

    // Handle rag_search with query
    if (toolName === 'rag_search' && input?.query) {
      return {
        toolName,
        displayText: t('thinking.searchingKnowledgeBase', {
          query: truncate(String(input.query), 25),
        }),
      };
    }

    // Default fallback display names for tools without detailed input
    const toolDisplayNames: Record<string, string> = {
      customer_read: t('tools.customerRead'),
      product_read: t('tools.productRead'),
      rag_search: t('tools.ragSearch'),
      web_read: t('tools.webRead'),
      pdf: t('tools.pdf'),
      image: t('tools.image'),
      pptx: t('tools.pptx'),
      docx: t('tools.docx'),
      resource_check: t('tools.resourceCheck'),
      workflow_read: t('tools.workflowRead'),
      update_workflow_step: t('tools.updateWorkflowStep'),
      save_workflow_definition: t('tools.saveWorkflowDefinition'),
      validate_workflow_definition: t('tools.validateWorkflowDefinition'),
      generate_excel: t('tools.generateExcel'),
      context_search: t('tools.contextSearch'),
    };

    const displayText =
      toolDisplayNames[toolName] ||
      toolName
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    return { toolName, displayText };
  };

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
  let displayText = t('thinking.default');

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
    const searchingPrefix = t('thinking.searching', { query: '' }).replace(
      '""',
      '',
    );
    const allSearches = uniqueDisplayTexts.every((text) =>
      text.startsWith(searchingPrefix),
    );

    if (allSearches && uniqueDisplayTexts.length > 1) {
      // Extract just the query parts (remove "Searching " prefix and closing quote)
      const queries = uniqueDisplayTexts.map((text) =>
        text.slice(
          searchingPrefix.length,
          text.endsWith('"') ? text.length : text.length,
        ),
      );
      if (queries.length <= 2) {
        displayText = t('thinking.searchingMultiple', {
          queries: queries.join(` ${t('thinking.and')} `),
        });
      } else {
        displayText = t('thinking.searchingMore', {
          first: queries[0],
          second: queries[1],
          count: queries.length - 2,
        });
      }
    } else if (uniqueDisplayTexts.length <= 2) {
      displayText = t('thinking.multipleTools', {
        first: uniqueDisplayTexts[0],
        second: uniqueDisplayTexts[1],
      });
    } else {
      // For 3+ different tool calls, show first two and count
      displayText = t('thinking.multipleToolsMore', {
        first: uniqueDisplayTexts[0],
        second: uniqueDisplayTexts[1],
        count: uniqueDisplayTexts.length - 2,
      });
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
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{
          duration: 0.3,
          ease: [0.25, 0.1, 0.25, 1],
        }}
        className="text-sm text-muted-foreground flex items-center gap-2 px-4 py-3"
      >
        <motion.span
          key={animationKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: 0.25,
            ease: [0.25, 0.1, 0.25, 1],
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

export function ChatInterface({
  organizationId,
  threadId,
}: ChatInterfaceProps) {
  const { t } = useT('chat');
  const router = useRouter();
  const { isPending, setIsPending, clearChatState } = useChatLayout();

  const [inputValue, setInputValue] = useState('');
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Fetch thread messages with streaming support
  // Use pagination to handle large threads - initialNumItems refers to MessageDocs
  // See: https://github.com/tale-project/tale/issues/85
  const {
    results: uiMessages,
    loadMore,
    status: paginationStatus,
  } = useUIMessages(
    api.threads.getThreadMessagesStreaming,
    threadId ? { threadId } : 'skip',
    { initialNumItems: 20, stream: true },
  );

  // Track pagination state for loading more messages
  // Backend now correctly sets isDone when page.length < numItems,
  // so we can trust the paginationStatus directly
  const canLoadMore = paginationStatus === 'CanLoadMore';
  const isLoadingMore = paginationStatus === 'LoadingMore';

  // Convert UIMessage to ChatMessage format for compatibility
  // Memoize to prevent unnecessary re-renders when typing
  //
  // Note: SDK's useUIMessages already handles deduplication via dedupeMessages()
  // using (order, stepOrder) as composite key. We only need to:
  // 1. Filter orphaned messages (Issue #184 edge case)
  // 2. Convert UIMessage to ChatMessage format
  const threadMessages: ChatMessage[] = useMemo(() => {
    if (!uiMessages?.length) return [];

    // Calculate minUserOrder for orphan filtering (Issue #184)
    // When pagination excludes a user message, its assistant response becomes orphaned
    const userMessages = uiMessages.filter((m) => m.role === 'user');
    const minUserOrder =
      userMessages.length > 0
        ? Math.min(...userMessages.map((m) => m.order))
        : 0;

    // Filter and convert in one pass
    // SDK already handles: deduplication, sorting, streaming vs persisted preference
    return uiMessages
      .filter((m) => {
        // Only keep user and assistant messages (filter out tool, system, etc.)
        if (m.role !== 'user' && m.role !== 'assistant') return false;
        // Filter orphaned assistant messages whose user message was paginated out
        // Issue #184: When pagination kicks in, old stream messages stay in state
        if (m.role === 'assistant' && m.order < minUserOrder) return false;
        return true;
      })
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
          // Mark messages with 'streaming' status as actively streaming
          // This triggers the TypewriterText animation in MessageBubble
          isStreaming: m.status === 'streaming',
        };
      });
  }, [uiMessages]);

  // Find if there's currently a streaming assistant message
  const streamingMessage = uiMessages?.find(
    (m) => m.role === 'assistant' && m.status === 'streaming',
  );

  // Check if there are any tools still executing in the streaming message
  // Tool parts have a `state` field: 'input-streaming', 'input-available', 'output-available', 'output-error'
  // Tools are "active" if they're still streaming input or waiting to execute
  const hasActiveTools = useMemo(() => {
    if (!streamingMessage?.parts) return false;
    return streamingMessage.parts.some((part) => {
      if (!part.type.startsWith('tool-')) return false;
      const toolPart = part as { state?: string };
      // Tool is active if it's still receiving input or has input ready but no output yet
      return (
        toolPart.state === 'input-streaming' ||
        toolPart.state === 'input-available'
      );
    });
  }, [streamingMessage?.parts]);

  // Fetch integration approvals for this thread
  const { approvals: integrationApprovals } = useIntegrationApprovals(threadId);

  // Fetch workflow creation approvals for this thread
  const { approvals: workflowCreationApprovals } =
    useWorkflowCreationApprovals(threadId);

  // Create a merged list of messages and approvals
  // Approvals are positioned right after their associated message (by messageId)
  // Only show approvals whose associated message is currently loaded (handles pagination)
  type ChatItem =
    | { type: 'message'; data: ChatMessage }
    | { type: 'approval'; data: IntegrationApproval }
    | { type: 'workflow_approval'; data: WorkflowCreationApproval };

  const mergedChatItems = useMemo((): ChatItem[] => {
    const items: ChatItem[] = [];

    // Build a set of currently loaded message IDs for filtering approvals
    const loadedMessageIds = new Set<string>();
    // Build a map of message id -> creation time for positioning approvals
    const messageTimeMap = new Map<string, number>();
    for (const message of threadMessages || []) {
      loadedMessageIds.add(message.id);
      const time = message._creationTime || message.timestamp.getTime();
      messageTimeMap.set(message.id, time);
    }

    // Add messages
    for (const message of threadMessages || []) {
      items.push({ type: 'message', data: message });
    }

    // Filter integration approvals:
    // 1. Must have a messageId (pending approvals without messageId are hidden until stream completes)
    // 2. The associated message must be currently loaded (handles pagination)
    const filteredIntegrationApprovals = (integrationApprovals || []).filter(
      (approval) => {
        // Must have a messageId to be displayed
        if (!approval.messageId) return false;
        // Only show if the associated message is currently loaded
        return loadedMessageIds.has(approval.messageId);
      },
    );

    // Add filtered integration approvals
    for (const approval of filteredIntegrationApprovals) {
      items.push({ type: 'approval', data: approval });
    }

    // Filter workflow creation approvals with same criteria
    const filteredWorkflowApprovals = (workflowCreationApprovals || []).filter(
      (approval) => {
        if (!approval.messageId) return false;
        return loadedMessageIds.has(approval.messageId);
      },
    );

    // Add filtered workflow creation approvals
    for (const approval of filteredWorkflowApprovals) {
      items.push({ type: 'workflow_approval', data: approval });
    }

    // Sort items:
    // - Messages are sorted by their creation time
    // - Approvals are positioned right after their associated message (by messageId)
    items.sort((a, b) => {
      const getItemSortKey = (item: ChatItem): number => {
        if (item.type === 'message') {
          return item.data._creationTime || item.data.timestamp.getTime();
        }
        // For approvals (both integration and workflow), position after the associated message
        const approval = item.data;
        const messageTime = messageTimeMap.get(approval.messageId!);
        if (messageTime !== undefined) {
          // Add 0.1ms offset to ensure approval appears after its message
          // Add 0.01 more for workflow approvals to maintain consistent ordering
          const offset = item.type === 'workflow_approval' ? 0.11 : 0.1;
          return messageTime + offset;
        }
        // Fallback (should not happen since we filtered above)
        return approval._creationTime;
      };

      return getItemSortKey(a) - getItemSortKey(b);
    });

    return items;
  }, [threadMessages, integrationApprovals, workflowCreationApprovals]);

  // Convex mutations
  const createThread = useCreateThread();
  const updateThread = useUpdateThread();
  const chatWithAgent = useChatWithAgent();

  // Derive loading state from streaming message or pending state
  // isPending = immediately after user clicks send, before mutation completes
  // streamingMessage = when AI is actively streaming a response
  const isLoading = isPending || !!streamingMessage;

  // Clear pending state ONLY when streaming message appears
  // isPending represents "waiting for AI to start responding"
  // The loading state should persist until we see actual streaming data
  useEffect(() => {
    if (!isPending) return;

    // Only clear when streaming actually starts
    if (streamingMessage) {
      setIsPending(false);
    }
  }, [streamingMessage, isPending, setIsPending]);

  // Auto-scroll handling - respects user intent (stops if user scrolls up)
  const { containerRef, contentRef, scrollToBottom, isAtBottom } =
    useAutoScroll({
      enabled: isLoading,
      threshold: 100,
    });

  const aiResponseAreaRef = useRef<HTMLDivElement>(null);

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
  }, [containerRef]);

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

  // Setup scroll listener for "scroll to bottom" button visibility
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const checkScroll = () => {
      setShowScrollButton(!isAtBottom());
    };

    container.addEventListener('scroll', checkScroll, { passive: true });
    return () => container.removeEventListener('scroll', checkScroll);
  }, [containerRef, isAtBottom]);

  // Scroll to bottom when navigating to a conversation with existing messages
  const hasScrolledOnLoadRef = useRef(false);
  useEffect(() => {
    // Only scroll once per thread when messages first load
    if (
      threadId &&
      threadMessages.length > 0 &&
      !hasScrolledOnLoadRef.current &&
      containerRef.current
    ) {
      hasScrolledOnLoadRef.current = true;
      // Use instant scroll for initial load (no animation)
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'instant',
      });
    }
  }, [threadId, threadMessages.length, containerRef]);

  // Reset scroll flag when navigating to a different thread
  useEffect(() => {
    hasScrolledOnLoadRef.current = false;
  }, [threadId]);

  const handleSendMessage = async (
    message: string,
    attachments?: FileAttachment[],
  ) => {
    const sanitizedContent = sanitizeChatMessage(message);
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

      // Send message with optimistic update (handled by useChatWithAgent hook)
      // Convert attachments to the format expected by the mutation
      const mutationAttachments = attachments?.map((a) => ({
        fileId: a.fileId,
        fileName: a.fileName,
        fileType: a.fileType,
        fileSize: a.fileSize,
      }));

      await chatWithAgent({
        threadId: currentThreadId,
        organizationId,
        message: sanitizedContent,
        attachments: mutationAttachments,
      });

      // Pending state will be cleared when streaming starts (see useEffect above)
    } catch (error) {
      clearChatState();
      setInputValue('');
      toast({
        title: error instanceof Error ? error.message : t('toast.sendFailed'),
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
        {/* Messages area - contentRef enables auto-scroll on content growth */}
        <div
          ref={contentRef}
          className={cn(
            'flex-1 overflow-y-visible p-4 sm:p-8',
            !threadId &&
              threadMessages?.length === 0 &&
              'flex flex-col items-center justify-end',
          )}
        >
          {!isLoading &&
            !threadId &&
            threadMessages?.length === 0 && (
              <div className="flex-1 flex items-center justify-center size-full">
                <h1 className="text-[2rem] font-semibold text-center">
                  {t('welcome')}
                </h1>
              </div>
            )}
          {(threadId || threadMessages?.length > 0) && (
            // Chat messages and approvals - show when we have a threadId OR messages
            <div
              className="max-w-[var(--chat-max-width)] mx-auto space-y-4"
              role="log"
              aria-live="polite"
              aria-label={t('aria.messageHistory')}
            >
              {/* Load More button for pagination */}
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
                        {t('history.loading')}
                      </>
                    ) : (
                      t('loadOlderMessages')
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
                } else if (item.type === 'approval') {
                  // Render integration approval card
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
                } else {
                  // Render workflow creation approval card
                  const approval = item.data;
                  return (
                    <div
                      key={`workflow-approval-${approval._id}`}
                      className="flex justify-start"
                    >
                      <WorkflowCreationApprovalCard
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

              {/* AI Response area - ref used for scroll positioning */}
              {/* Show ThinkingAnimation when:
                  1. Waiting for AI response (isPending, no streaming yet), OR
                  2. Message is streaming but has no text content yet, OR
                  3. Tools are actively executing (even if text has started streaming)

                  Note: We check status === 'streaming' explicitly to ensure the indicator
                  stays visible during gaps in tool state transitions (when one tool completes
                  but no text has been output yet). */}
              <div ref={aiResponseAreaRef}>
                {((isPending && !streamingMessage) ||
                  (streamingMessage?.status === 'streaming' &&
                    !streamingMessage.text) ||
                  hasActiveTools) && (
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
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute bottom-32 left-1/2 -translate-x-1/2 z-10"
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
  );
}
