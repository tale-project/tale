'use client';

import { useUIMessages, type UIMessage } from '@convex-dev/agent/react';
import { useQuery } from 'convex/react';
import { motion } from 'framer-motion';
import {
  Bot,
  Send,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Paperclip,
  X,
  LoaderCircle,
} from 'lucide-react';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { Image } from '@/app/components/ui/data-display/image';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Button } from '@/app/components/ui/primitives/button';
import { ImagePreviewDialog } from '@/app/features/chat/components/message-bubble';
import { useConvexFileUpload } from '@/app/features/chat/hooks/use-convex-file-upload';
import { useCreateThread } from '@/app/features/chat/hooks/use-create-thread';
import { useDeleteThread } from '@/app/features/chat/hooks/use-delete-thread';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useThrottledScroll } from '@/app/hooks/use-throttled-scroll';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { stripWorkflowContext } from '@/lib/utils/message-helpers';
import { TEXT_FILE_ACCEPT } from '@/lib/utils/text-file-types';

import { useChatWithWorkflowAssistant } from '../hooks/use-chat-with-workflow-assistant';
import { useUpdateAutomationMetadata } from '../hooks/use-update-automation-metadata';

// Module-level guard to prevent duplicate sends (survives component remounts)
const recentSends = new Map<string, number>();
const DUPLICATE_WINDOW_MS = 5000;

function canSendMessage(content: string, threadId: string | null): boolean {
  const key = `${threadId || 'new'}:${content.trim().toLowerCase()}`;
  const lastSent = recentSends.get(key);
  const now = Date.now();

  if (lastSent && now - lastSent < DUPLICATE_WINDOW_MS) {
    console.warn('[AutomationAssistant] Blocked duplicate send:', key);
    return false;
  }

  recentSends.set(key, now);
  // Clean old entries
  for (const [k, time] of recentSends) {
    if (now - time > DUPLICATE_WINDOW_MS) {
      recentSends.delete(k);
    }
  }
  return true;
}

// File part from UIMessage.parts
interface FilePart {
  type: 'file';
  mediaType: string;
  filename?: string;
  url: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  automationContext?: string; // Optional automation context for first user message
  fileParts?: FilePart[]; // File parts from server messages
  clientMessageId?: string; // Client-side correlation ID for optimistic message deduplication
}

function AutomationDetailsCollapse({
  context,
  title,
}: {
  context: string;
  title: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-muted mb-2 overflow-hidden rounded-lg border">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-muted/50 hover:bg-muted flex w-full items-center justify-between px-3 py-2 text-left transition-colors"
      >
        <span className="text-muted-foreground text-xs font-medium">
          {title}
        </span>
        {isOpen ? (
          <ChevronDown className="text-muted-foreground size-3.5" />
        ) : (
          <ChevronRight className="text-muted-foreground size-3.5" />
        )}
      </button>
      {isOpen && (
        <div className="bg-background px-3 py-2">
          <pre className="text-muted-foreground font-mono text-xs whitespace-pre-wrap">
            {context}
          </pre>
        </div>
      )}
    </div>
  );
}

function ThinkingAnimation({ steps }: { steps: string[] }) {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (currentStep < steps.length - 1) {
      interval = setInterval(() => {
        setCurrentStep((prev) => prev + 1);
      }, 2500);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentStep, steps.length]);

  return (
    <div className="flex justify-start">
      <motion.div
        key={currentStep}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{
          duration: 0.3,
          ease: [0.25, 0.1, 0.25, 1],
        }}
        className="text-muted-foreground flex items-center gap-2 px-3 text-xs"
      >
        <motion.span
          key={currentStep}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: 0.25,
            ease: [0.25, 0.1, 0.25, 1],
          }}
          className="inline-block"
        >
          {steps[currentStep]}
        </motion.span>
        <div className="flex space-x-1">
          <div className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full" />
          <div
            className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full"
            style={{ animationDelay: '0.1s' }}
          />
          <div
            className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full"
            style={{ animationDelay: '0.2s' }}
          />
        </div>
      </motion.div>
    </div>
  );
}

const USER_MESSAGE_TRUNCATE_LENGTH = 120;
const ASSISTANT_MESSAGE_TRUNCATE_LENGTH = 250;

function CollapsibleMessage({
  content,
  role,
  isMarkdown = false,
  viewMoreLabel,
  viewLessLabel,
  isLastMessage = false,
}: {
  content: string;
  role: 'user' | 'assistant';
  isMarkdown?: boolean;
  viewMoreLabel: string;
  viewLessLabel: string;
  isLastMessage?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(isLastMessage);
  const truncateLength =
    role === 'user'
      ? USER_MESSAGE_TRUNCATE_LENGTH
      : ASSISTANT_MESSAGE_TRUNCATE_LENGTH;
  const shouldTruncate = content.length > truncateLength;

  useEffect(() => {
    if (isLastMessage) {
      setIsExpanded(true);
    }
  }, [isLastMessage]);
  const displayContent =
    shouldTruncate && !isExpanded
      ? content.slice(0, truncateLength) + '...'
      : content;

  return (
    <div className="flex flex-col gap-1">
      {isMarkdown ? (
        <div className="prose prose-sm dark:prose-invert prose-p:my-0.5 prose-pre:my-1 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md prose-pre:p-2 prose-pre:overflow-x-auto prose-pre:text-[10px] prose-headings:my-1 prose-headings:text-xs [&_code]:bg-muted-foreground/10 [&_code]:text-muted-foreground max-w-none text-xs [&_code]:inline-block [&_code]:max-w-full [&_code]:rounded-md [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[10px] [&_code]:break-words [&_code]:whitespace-normal [&_h3]:mt-1 [&_h3]:text-xs [&_li]:mb-0.5 [&_ol]:mt-0.5 [&_ol]:mb-0.5 [&_ol]:list-decimal [&_ol]:pl-3 [&_p]:mt-0.5 [&_p]:mb-0.5 [&_p]:leading-relaxed [&_p]:break-words [&_pre_code]:block [&_pre_code]:overflow-auto [&_pre_code]:break-normal [&_pre_code]:whitespace-pre [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-3">
          <Bot className="text-muted-foreground mb-1.5 size-3.5" />
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {displayContent}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="text-xs leading-relaxed whitespace-pre-wrap">
          {displayContent}
        </p>
      )}
      {shouldTruncate && (
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            'text-[10px] font-medium flex items-center gap-0.5 self-start transition-colors ml-auto',
            role === 'user'
              ? 'text-primary-foreground/70 hover:text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {isExpanded ? (
            <>
              {viewLessLabel}
              <ChevronUp className="size-3" />
            </>
          ) : (
            <>
              {viewMoreLabel}
              <ChevronDown className="size-3" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

interface AutomationAssistantProps {
  automationId?: Id<'wfDefinitions'>;
  organizationId: string;
  onClearChat?: () => void;
  onClearChatStateChange?: (canClear: boolean, clearFn: () => void) => void;
}

function AutomationAssistantContent({
  automationId,
  organizationId,
  onClearChat,
  onClearChatStateChange,
}: AutomationAssistantProps) {
  const { t } = useT('automations');

  const {
    attachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    clearAttachments,
  } = useConvexFileUpload();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isSendingRef = useRef(false);
  const [previewImage, setPreviewImage] = useState<{
    isOpen: boolean;
    src: string;
    alt: string;
  } | null>(null);
  const { throttledScrollToBottom, cleanup } = useThrottledScroll({
    delay: 16,
  });

  // Connect to workflow assistant agent
  const chatWithWorkflowAssistant = useChatWithWorkflowAssistant();
  const createChatThread = useCreateThread();
  const deleteChatThread = useDeleteThread();
  const updateWorkflowMetadata = useUpdateAutomationMetadata();

  // Load workflow to get threadId from metadata (use public API)
  const workflow = useQuery(
    api.wf_definitions.queries.getWorkflow,
    automationId ? { wfDefinitionId: automationId } : 'skip',
  );

  const { results: uiMessages } = useUIMessages(
    api.threads.queries.getThreadMessagesStreaming as any,
    threadId ? { threadId } : 'skip',
    { initialNumItems: 100, stream: true },
  ) as unknown as { results: UIMessage[] | undefined };

  // Load threadId from workflow metadata when workflow is loaded
  useEffect(() => {
    if (workflow?.metadata?.threadId && !threadId) {
      setThreadId(String(workflow.metadata.threadId));
    }
  }, [workflow, threadId, automationId]);

  // Transform uiMessages to Message[] format using useMemo to avoid recreating on every render
  const transformedMessages = useMemo(() => {
    if (!uiMessages || uiMessages.length === 0) return [];

    return uiMessages
      .filter(
        (m): m is typeof m & { role: 'user' | 'assistant' } =>
          m.role === 'user' || m.role === 'assistant',
      )
      .map((m) => {
        // Extract file parts (images) from UIMessage.parts
        const fileParts = (
          (m.parts || []) as Array<{
            type: string;
            mediaType?: string;
            filename?: string;
            url?: string;
          }>
        )
          .filter(
            (p): p is FilePart =>
              p.type === 'file' &&
              typeof p.url === 'string' &&
              typeof p.mediaType === 'string',
          )
          .map((p) => ({
            type: 'file' as const,
            mediaType: p.mediaType,
            filename: p.filename,
            url: p.url,
          }));

        return {
          id: m.key,
          role: m.role,
          content: m.role === 'user' ? stripWorkflowContext(m.text) : m.text,
          timestamp: new Date(m._creationTime),
          fileParts: fileParts.length > 0 ? fileParts : undefined,
          automationContext: undefined,
          clientMessageId: undefined,
        };
      });
  }, [uiMessages]);

  // Create a stable key for comparison to detect actual content changes
  const messagesKey = useMemo(() => {
    return transformedMessages
      .map((m) => `${m.id}:${m.content.length}`)
      .join('|');
  }, [transformedMessages]);

  // Track optimistic pending user message (not yet confirmed by backend)
  const [pendingUserMessage, setPendingUserMessage] = useState<Message | null>(
    null,
  );

  // Sync messages from thread - clear pending message once real messages arrive
  useEffect(() => {
    if (transformedMessages.length > 0) {
      setMessages(transformedMessages);
      // Clear pending message once server confirms it
      // Match by timestamp proximity OR normalized content equality
      if (pendingUserMessage) {
        const pendingTimestamp = pendingUserMessage.timestamp.getTime();
        const toleranceMs = 60000;
        const pendingContent = pendingUserMessage.content.trim().toLowerCase();
        const hasMatchingServerMessage = transformedMessages.some(
          (m) =>
            m.role === 'user' &&
            (Math.abs(m.timestamp.getTime() - pendingTimestamp) < toleranceMs ||
              m.content.trim().toLowerCase() === pendingContent),
        );
        if (hasMatchingServerMessage) {
          setPendingUserMessage(null);
        }
      }
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Only re-run when messagesKey changes; adding pendingUserMessage would cause infinite update loops
  }, [messagesKey]);

  // Combine confirmed messages with pending optimistic message for display
  // Use transformedMessages directly to avoid timing lag with messages state
  const displayMessages = useMemo(() => {
    const serverMessages =
      transformedMessages.length > 0 ? transformedMessages : messages;

    if (!pendingUserMessage) return serverMessages;
    if (serverMessages.length === 0) {
      return [pendingUserMessage];
    }
    // Match by timestamp proximity OR normalized content equality
    // This handles both server content normalization and timing edge cases
    const pendingTimestamp = pendingUserMessage.timestamp.getTime();
    const toleranceMs = 60000;
    const pendingContent = pendingUserMessage.content.trim().toLowerCase();

    const hasMatchingServerMessage = serverMessages.some(
      (m) =>
        m.role === 'user' &&
        (Math.abs(m.timestamp.getTime() - pendingTimestamp) < toleranceMs ||
          m.content.trim().toLowerCase() === pendingContent),
    );
    if (!hasMatchingServerMessage) {
      return [...serverMessages, pendingUserMessage];
    }
    return serverMessages;
  }, [transformedMessages, messages, pendingUserMessage]);

  // Scroll to bottom when new messages arrive using throttled scroll
  useEffect(() => {
    if (displayMessages.length === 0) return;

    if (containerRef.current) {
      throttledScrollToBottom(containerRef.current, 'auto');
    }
  }, [displayMessages.length, throttledScrollToBottom]);

  // Cleanup throttled scroll on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      uploadFiles(Array.from(files));
    }
    // Reset input to allow selecting the same file again
    e.target.value = '';
  };

  // Handle paste event for images
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const extension = item.type.split('/')[1] || 'png';
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const renamedFile = new File(
            [file],
            `pasted-image-${timestamp}.${extension}`,
            { type: file.type },
          );
          imageFiles.push(renamedFile);
        }
      }
    }

    if (imageFiles.length > 0) {
      uploadFiles(imageFiles);
    }
  };

  const handleSendMessage = async () => {
    if (isSendingRef.current) return;
    if (
      (!inputValue.trim() && attachments.length === 0) ||
      isLoading ||
      !organizationId
    )
      return;

    const messageContent = inputValue.trim();

    // Module-level duplicate prevention (survives component remounts)
    if (!canSendMessage(messageContent, threadId)) {
      return;
    }

    isSendingRef.current = true;

    // Capture and clear attachments in one operation
    const clearedAttachments = clearAttachments();
    const attachmentsToSend =
      clearedAttachments.length > 0 ? clearedAttachments : undefined;

    // Create optimistic user message for immediate display
    const clientMessageId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const optimisticMessage: Message = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content: messageContent,
      timestamp: new Date(),
      clientMessageId,
    };
    setPendingUserMessage(optimisticMessage);

    // Clear input immediately for better UX
    setInputValue('');
    setIsLoading(true);

    try {
      // Ensure we have a real Agent thread for this automation chat
      let currentThreadId = threadId;
      if (!currentThreadId) {
        const title =
          messageContent.length > 50
            ? `${messageContent.substring(0, 50)}...`
            : messageContent;

        currentThreadId = await createChatThread({
          organizationId: organizationId as string,
          title,
          chatType: 'workflow_assistant',
        });
        setThreadId(currentThreadId);

        // Persist threadId to workflow metadata so it survives page navigation
        if (automationId && user?.userId) {
          await updateWorkflowMetadata({
            wfDefinitionId: automationId,
            metadata: { ...workflow?.metadata, threadId: currentThreadId },
            updatedBy: user.userId,
          });
        }
      }

      // Prepare attachments for the agent
      const mutationAttachments = attachmentsToSend
        ? attachmentsToSend.map((a) => ({
            fileId: a.fileId,
            fileName: a.fileName,
            fileType: a.fileType,
            fileSize: a.fileSize,
          }))
        : undefined;

      // Call the workflow assistant agent with a real Agent thread id
      // Messages will be automatically synced from threadMessages query
      await chatWithWorkflowAssistant({
        threadId: currentThreadId!,
        organizationId,
        workflowId: automationId,
        message: messageContent || t('assistant.analyzeAttachments'),
        attachments: mutationAttachments,
      });
    } catch (error) {
      console.error('Error calling workflow assistant:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: t('assistant.errorMessage'),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      isSendingRef.current = false;
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearChat = useCallback(async () => {
    if (!user?.userId) {
      console.error('User not authenticated');
      return;
    }

    try {
      // Delete the thread if it exists
      if (threadId) {
        await deleteChatThread({
          threadId: threadId,
        });
      }

      // Reset threadId in workflow metadata if automationId exists
      if (automationId && workflow?.metadata) {
        await updateWorkflowMetadata({
          wfDefinitionId: automationId,
          metadata: { ...workflow.metadata, threadId: null },
          updatedBy: user.userId,
        });
      }

      // Reset local state
      setThreadId(null);
      setMessages([]);
      setInputValue('');

      // Call parent callback if provided
      onClearChat?.();
    } catch (error) {
      console.error('Error clearing chat:', error);
      // Still reset local state even if server updates fail
      setThreadId(null);
      setMessages([]);
      setInputValue('');
    }
  }, [
    user?.userId,
    threadId,
    automationId,
    workflow?.metadata,
    deleteChatThread,
    updateWorkflowMetadata,
    onClearChat,
  ]);

  // Report clear chat state to parent
  useEffect(() => {
    const canClear = displayMessages.length > 0 && !!threadId;
    onClearChatStateChange?.(canClear, handleClearChat);
  }, [
    displayMessages.length,
    threadId,
    handleClearChat,
    onClearChatStateChange,
  ]);

  return (
    <div
      ref={containerRef}
      className="relative flex flex-1 flex-col overflow-y-auto"
    >
      {/* Chat messages */}
      <div className="flex flex-1 flex-col space-y-2.5 p-2">
        {displayMessages.length === 0 ? (
          <div className="flex h-full flex-col items-start justify-start py-4">
            <div className="flex items-start gap-2">
              <div className="bg-muted h-fit shrink-0 rounded-lg p-1.5">
                <Bot className="text-muted-foreground size-3.5" />
              </div>
              <div className="bg-muted text-foreground max-w-[85%] rounded-lg px-3 py-2">
                {workflow === undefined ? (
                  <div className="flex items-center gap-2">
                    <LoaderCircle className="text-muted-foreground size-3 animate-spin" />
                    <p className="text-muted-foreground text-xs">
                      {t('assistant.loading')}
                    </p>
                  </div>
                ) : workflow === null ? (
                  <p className="text-muted-foreground text-xs">
                    {t('assistant.notFound')}
                  </p>
                ) : (
                  <p className="text-xs">
                    {workflow.status === 'draft'
                      ? t('assistant.welcomeDraft')
                      : t('assistant.welcomeActive')}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            {displayMessages.map((message, index) => (
              <div
                key={message.id}
                className={cn(
                  'flex gap-1',
                  message.role === 'user' ? 'justify-end' : 'justify-start',
                )}
              >
                <div className="flex max-w-[92.5%] flex-col gap-2">
                  {message.automationContext && (
                    <AutomationDetailsCollapse
                      context={message.automationContext}
                      title={t('assistant.automationDetails')}
                    />
                  )}
                  {/* Display file parts (images) */}
                  {message.fileParts && message.fileParts.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {message.fileParts.map((part, index) =>
                        part.mediaType.startsWith('image/') ? (
                          <button
                            key={index}
                            type="button"
                            onClick={() =>
                              setPreviewImage({
                                isOpen: true,
                                src: part.url,
                                alt:
                                  part.filename || t('assistant.fallbackImage'),
                              })
                            }
                            className="bg-muted focus:ring-ring size-11 cursor-pointer overflow-hidden rounded-lg bg-cover bg-center bg-no-repeat transition-opacity hover:opacity-90 focus:ring-2 focus:ring-offset-2 focus:outline-none"
                          >
                            <Image
                              src={part.url}
                              alt={
                                part.filename || t('assistant.fallbackImage')
                              }
                              className="size-full object-cover"
                              width={44}
                              height={44}
                            />
                          </button>
                        ) : (
                          <a
                            key={index}
                            href={part.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-muted hover:bg-muted/80 flex max-w-[13.5rem] items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
                          >
                            <DocumentIcon fileName={part.filename || 'file'} />
                            <div className="flex min-w-0 flex-1 flex-col">
                              <div className="text-foreground truncate text-sm font-medium">
                                {part.filename || t('assistant.fallbackFile')}
                              </div>
                            </div>
                          </a>
                        ),
                      )}
                    </div>
                  )}
                  {message.content && (
                    <div
                      className={cn(
                        'rounded-lg px-2.5 py-2',
                        message.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground',
                      )}
                    >
                      <CollapsibleMessage
                        content={message.content}
                        role={message.role}
                        isMarkdown={message.role === 'assistant'}
                        viewMoreLabel={t('assistant.viewMore')}
                        viewLessLabel={t('assistant.viewLess')}
                        isLastMessage={index === displayMessages.length - 1}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <ThinkingAnimation
                steps={[
                  t('assistant.thinking.thinking'),
                  t('assistant.thinking.analyzing'),
                  t('assistant.thinking.compiling'),
                ]}
              />
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Hidden file input - inside scrollable container for sticky to work */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={TEXT_FILE_ACCEPT}
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {/* Chat input */}
      <FileUpload.DropZone
        className="border-muted sticky bottom-0 z-50 mx-2 rounded-t-3xl border-[0.5rem] border-b-0"
        onFilesSelected={uploadFiles}
        clickable={false}
      >
        <FileUpload.Overlay className="rounded-t-2xl" />
        <div className="bg-background border-muted-foreground/50 relative rounded-t-[0.875rem] border border-b-0 p-1">
          {/* Attachment previews */}
          {(attachments.length > 0 || uploadingFiles.length > 0) && (
            <div className="flex flex-wrap gap-2 p-1">
              {/* Uploading files indicator */}
              {uploadingFiles.map((fileId) => (
                <div
                  key={fileId}
                  className="bg-muted flex items-center gap-1 rounded-lg px-2 py-1"
                >
                  <LoaderCircle className="size-3 animate-spin" />
                  <span className="text-muted-foreground text-xs">
                    {t('assistant.upload.uploading')}
                  </span>
                </div>
              ))}

              {/* Image previews */}
              {attachments
                .filter((att) => att.fileType.startsWith('image/'))
                .map((attachment) => (
                  <div key={attachment.fileId} className="group relative">
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.fileName}
                      className="border-border size-8 rounded-lg border object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.fileId)}
                      className="bg-destructive text-destructive-foreground absolute -top-1 -right-1 rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}

              {/* File attachments */}
              {attachments
                .filter((att) => !att.fileType.startsWith('image/'))
                .map((attachment) => (
                  <div
                    key={attachment.fileId}
                    className="group bg-secondary/20 relative flex max-w-[150px] items-center gap-2 rounded-lg px-2 py-1"
                  >
                    <DocumentIcon fileName={attachment.fileName} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="text-foreground truncate text-xs font-medium">
                        {attachment.fileName}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.fileId)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
            </div>
          )}

          <div className="h-[5rem] overflow-y-auto transition-all duration-300 ease-in-out">
            <Textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={t('assistant.messagePlaceholder')}
              className="resize-none border-0 bg-transparent p-2 text-sm outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
              disabled={isLoading}
            />
          </div>
          <div className="flex items-center justify-between px-1">
            {/* Attachment button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              title={t('assistant.attachFiles')}
            >
              <Paperclip className="size-4" />
            </button>

            <Button
              onClick={handleSendMessage}
              disabled={
                (!inputValue.trim() && attachments.length === 0) || isLoading
              }
              size="icon"
              className="rounded-full"
            >
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      </FileUpload.DropZone>

      {/* Image preview dialog */}
      {previewImage && (
        <ImagePreviewDialog
          isOpen={previewImage.isOpen}
          onOpenChange={(open) => {
            if (!open) setPreviewImage(null);
          }}
          src={previewImage.src}
          alt={previewImage.alt}
        />
      )}
    </div>
  );
}

export function AutomationAssistant(props: AutomationAssistantProps) {
  return (
    <FileUpload.Root>
      <AutomationAssistantContent {...props} />
    </FileUpload.Root>
  );
}
