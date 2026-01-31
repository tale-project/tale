'use client';

import { Button } from '@/app/components/ui/primitives/button';
import { Textarea } from '@/app/components/ui/forms/textarea';
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
import { cn } from '@/lib/utils/cn';
import { stripWorkflowContext } from '@/lib/utils/message-helpers';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Id } from '@/convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useChatWithWorkflowAssistant } from '../hooks/use-chat-with-workflow-assistant';
import { useUpdateAutomationMetadata } from '../hooks/use-update-automation-metadata';
import { useCreateThread } from '@/app/features/chat/hooks/use-create-thread';
import { useDeleteThread } from '@/app/features/chat/hooks/use-delete-thread';
import { useGenerateUploadUrl } from '@/app/features/chat/hooks/use-generate-upload-url';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useThrottledScroll } from '@/app/hooks/use-throttled-scroll';
import { toast } from '@/app/hooks/use-toast';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { useUIMessages, type UIMessage } from '@convex-dev/agent/react';
import { Image } from '@/app/components/ui/data-display/image';
import { ImagePreviewDialog } from '@/app/features/chat/components/message-bubble';
import type { FileAttachment as BaseFileAttachment } from '@/convex/lib/attachments/types';
import { useT } from '@/lib/i18n/client';

interface FileAttachment extends BaseFileAttachment {
  previewUrl?: string;
}

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

export interface Message {
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
    <div className="border border-muted rounded-lg overflow-hidden mb-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted transition-colors text-left"
      >
        <span className="text-xs font-medium text-muted-foreground">
          {title}
        </span>
        {isOpen ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {isOpen && (
        <div className="px-3 py-2 bg-background">
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
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
        className="text-xs text-muted-foreground flex items-center gap-2 px-3"
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
        <div className="text-xs prose prose-sm dark:prose-invert max-w-none prose-p:my-0.5 prose-pre:my-1 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md prose-pre:p-2 prose-pre:overflow-x-auto prose-pre:text-[10px] prose-headings:my-1 prose-headings:text-xs [&_li]:mb-0.5 [&_ul]:my-1 [&_ul]:pl-3 [&_ul]:list-disc [&_ol]:mb-0.5 [&_ol]:mt-0.5 [&_ol]:pl-3 [&_ol]:list-decimal [&_code]:bg-muted-foreground/10 [&_code]:text-[10px] [&_code]:text-muted-foreground [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:font-mono [&_code]:break-words [&_code]:whitespace-normal [&_code]:inline-block [&_code]:max-w-full [&_pre_code]:overflow-auto [&_pre_code]:block [&_pre_code]:whitespace-pre [&_pre_code]:break-normal [&_p]:mb-0.5 [&_p]:mt-0.5 [&_p]:break-words [&_p]:leading-relaxed [&_h3]:mt-1 [&_h3]:text-xs">
          <Bot className="size-3.5 text-muted-foreground mb-1.5" />
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {displayContent}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="text-xs whitespace-pre-wrap leading-relaxed">
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

export function AutomationAssistant({
  automationId,
  organizationId,
  onClearChat,
  onClearChatStateChange,
}: AutomationAssistantProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isSendingRef = useRef(false);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  const [previewImage, setPreviewImage] = useState<{
    isOpen: boolean;
    src: string;
    alt: string;
  } | null>(null);
  const { throttledScrollToBottom, cleanup } = useThrottledScroll({
    delay: 16,
  });

  const generateUploadUrl = useGenerateUploadUrl();

  // Connect to workflow assistant agent
  const chatWithWorkflowAssistant = useChatWithWorkflowAssistant();
  const createChatThread = useCreateThread();
  const deleteChatThread = useDeleteThread();
  const updateWorkflowMetadata = useUpdateAutomationMetadata();

  // Load workflow to get threadId from metadata (use public API)
  const workflow = useQuery(
    api.wf_definitions.queries.getWorkflowPublic,
    automationId ? { wfDefinitionId: automationId } : 'skip',
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when messagesKey changes; pendingUserMessage is read but not a trigger to avoid update loops
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

  // File upload functions
  const uploadFiles = async (files: FileList) => {
    const fileArray = Array.from(files);
    const maxFileSize = 10 * 1024 * 1024; // 10MB limit
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ];

    // Validate files
    const invalidFiles = fileArray.filter(
      (file) => file.size > maxFileSize || !allowedTypes.includes(file.type),
    );

    if (invalidFiles.length > 0) {
      toast({
        title: t('assistant.upload.invalidFiles'),
        description: t('assistant.upload.invalidFilesDescription'),
        variant: 'destructive',
      });
      return;
    }

    // Upload each file
    const uploadPromises = fileArray.map(async (file) => {
      const fileId = `${file.name}-${Date.now()}`;
      setUploadingFiles((prev) => [...prev, fileId]);

      try {
        // Get upload URL from Convex
        const uploadUrl = await generateUploadUrl();

        // Upload file to Convex storage
        const result = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': file.type },
          body: file,
        });

        if (!result.ok) {
          throw new Error('Upload failed');
        }

        const { storageId } = await result.json();

        // Create attachment object
        const attachment: FileAttachment = {
          fileId: storageId,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          previewUrl: file.type.startsWith('image/')
            ? URL.createObjectURL(file)
            : undefined,
        };

        setAttachments((prev) => [...prev, attachment]);

        toast({
          title: t('assistant.upload.success'),
          description: t('assistant.upload.successDescription', {
            fileName: file.name,
          }),
        });
      } catch (error) {
        console.error('Upload error:', error);
        toast({
          title: t('assistant.upload.failed'),
          description: t('assistant.upload.failedDescription', {
            fileName: file.name,
          }),
          variant: 'destructive',
        });
      } finally {
        setUploadingFiles((prev) => prev.filter((id) => id !== fileId));
      }
    });

    await Promise.all(uploadPromises);
  };

  const removeAttachment = (fileId: Id<'_storage'>) => {
    setAttachments((prev) => {
      const attachment = prev.find((att) => att.fileId === fileId);
      if (attachment?.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
      return prev.filter((att) => att.fileId !== fileId);
    });
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      uploadFiles(files);
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
      const dataTransfer = new DataTransfer();
      imageFiles.forEach((file) => dataTransfer.items.add(file));
      uploadFiles(dataTransfer.files);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      uploadFiles(files);
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

    // Capture attachments before clearing
    const attachmentsToSend =
      attachments.length > 0 ? [...attachments] : undefined;

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

    // Clear input and attachments immediately for better UX
    setInputValue('');
    // Clean up preview URLs before clearing
    attachments.forEach((att) => {
      if (att.previewUrl) {
        URL.revokeObjectURL(att.previewUrl);
      }
    });
    setAttachments([]);
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
      className="flex-1 flex flex-col overflow-y-auto relative"
    >
      {/* Chat messages */}
      <div className="flex-1 flex flex-col p-2 space-y-2.5">
        {displayMessages.length === 0 ? (
          <div className="flex flex-col items-start justify-start h-full py-4">
            <div className="flex gap-2 items-start">
              <div className="p-1.5 rounded-lg bg-muted shrink-0 h-fit">
                <Bot className="size-3.5 text-muted-foreground" />
              </div>
              <div className="rounded-lg px-3 py-2 bg-muted text-foreground max-w-[85%]">
                {workflow === undefined ? (
                  <div className="flex items-center gap-2">
                    <LoaderCircle className="size-3 animate-spin text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">
                      {t('assistant.loading')}
                    </p>
                  </div>
                ) : workflow === null ? (
                  <p className="text-xs text-muted-foreground">
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
                <div className="flex flex-col gap-2 max-w-[92.5%]">
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
                            className="size-11 rounded-lg bg-muted bg-center bg-cover bg-no-repeat overflow-hidden cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
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
                            className="bg-muted rounded-lg px-2 py-1.5 flex items-center gap-2 hover:bg-muted/80 transition-colors max-w-[13.5rem]"
                          >
                            <DocumentIcon fileName={part.filename || 'file'} />
                            <div className="flex flex-col min-w-0 flex-1">
                              <div className="text-sm font-medium text-foreground truncate">
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
        accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.txt"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {/* Chat input */}
      <div
        className={cn(
          'border-muted rounded-t-3xl border-[0.5rem] border-b-0 mx-2 sticky bottom-0 z-50',
          isDragOver && 'ring-2 ring-primary ring-offset-2',
        )}
        role="region"
        aria-label={tCommon('aria.dropFilesHere')}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="bg-background rounded-t-[0.875rem] relative p-1 border border-muted-foreground/50 border-b-0">
          {/* Attachment previews */}
          {(attachments.length > 0 || uploadingFiles.length > 0) && (
            <div className="flex flex-wrap gap-2 p-2 border-b border-border">
              {/* Uploading files indicator */}
              {uploadingFiles.map((fileId) => (
                <div
                  key={fileId}
                  className="flex items-center gap-1 bg-muted rounded-lg px-2 py-1"
                >
                  <LoaderCircle className="size-3 animate-spin" />
                  <span className="text-xs text-muted-foreground">
                    {t('assistant.upload.uploading')}
                  </span>
                </div>
              ))}

              {/* Image previews */}
              {attachments
                .filter((att) => att.fileType.startsWith('image/'))
                .map((attachment) => (
                  <div key={attachment.fileId} className="relative group">
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.fileName}
                      className="w-12 h-12 object-cover rounded-lg border border-border"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.fileId)}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
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
                    className="relative group bg-secondary/20 rounded-lg px-2 py-1 flex items-center gap-2 max-w-[150px]"
                  >
                    <DocumentIcon fileName={attachment.fileName} />
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="text-xs font-medium text-foreground truncate">
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

          <div className="transition-all duration-300 ease-in-out overflow-y-auto h-[5rem]">
            <Textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={t('assistant.messagePlaceholder')}
              className="resize-none border-0 outline-none bg-transparent p-2 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm"
              disabled={isLoading}
            />
          </div>
          <div className="flex items-center justify-between px-1">
            {/* Attachment button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
      </div>

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
