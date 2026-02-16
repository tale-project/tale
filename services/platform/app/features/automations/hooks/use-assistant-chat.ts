'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useCreateThread,
  useDeleteThread,
} from '@/app/features/chat/hooks/mutations';
import { useThreadMessages } from '@/app/features/chat/hooks/queries';
import { useConvexFileUpload } from '@/app/features/chat/hooks/use-convex-file-upload';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useThrottledScroll } from '@/app/hooks/use-throttled-scroll';
import { Id } from '@/convex/_generated/dataModel';
import { stripWorkflowContext } from '@/lib/utils/message-helpers';

import type {
  FilePart,
  Message,
} from '../components/automation-assistant/types';

import { useChatWithWorkflowAssistant } from './actions';
import { useUpdateAutomationMetadata } from './mutations';
import { useWorkflow } from './queries';

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
  for (const [k, time] of recentSends) {
    if (now - time > DUPLICATE_WINDOW_MS) {
      recentSends.delete(k);
    }
  }
  return true;
}

interface UseAssistantChatOptions {
  automationId?: Id<'wfDefinitions'>;
  organizationId: string;
  onClearChat?: () => void;
  onClearChatStateChange?: (canClear: boolean, clearFn: () => void) => void;
  errorMessageText: string;
  analyzeAttachmentsText: string;
}

export function useAssistantChat({
  automationId,
  organizationId,
  onClearChat,
  onClearChatStateChange,
  errorMessageText,
  analyzeAttachmentsText,
}: UseAssistantChatOptions) {
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

  const { mutateAsync: chatWithWorkflowAssistant } =
    useChatWithWorkflowAssistant();
  const { mutateAsync: createChatThread } = useCreateThread();
  const { mutateAsync: deleteChatThread } = useDeleteThread();
  const { mutateAsync: updateWorkflowMetadata } = useUpdateAutomationMetadata();

  const { data: workflow } = useWorkflow(automationId);

  const uiMessages = useThreadMessages(threadId);

  // Load threadId from workflow metadata when workflow is loaded
  useEffect(() => {
    if (workflow?.metadata?.threadId && !threadId) {
      setThreadId(String(workflow.metadata.threadId));
    }
  }, [workflow, threadId, automationId]);

  // Transform uiMessages to Message[] format
  const transformedMessages = useMemo(() => {
    if (!uiMessages || uiMessages.length === 0) return [];

    return uiMessages
      .filter(
        (m): m is typeof m & { role: 'user' | 'assistant' } =>
          m.role === 'user' || m.role === 'assistant',
      )
      .map((m) => {
        const fileParts =
          // UIMessage.parts is loosely typed — cast required to access file-specific fields
          (
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

  const messagesKey = useMemo(() => {
    return transformedMessages
      .map((m) => `${m.id}:${m.content.length}`)
      .join('|');
  }, [transformedMessages]);

  const [pendingUserMessage, setPendingUserMessage] = useState<Message | null>(
    null,
  );

  // Sync messages from thread
  useEffect(() => {
    if (transformedMessages.length > 0) {
      setMessages(transformedMessages);
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

  const displayMessages = useMemo(() => {
    const serverMessages =
      transformedMessages.length > 0 ? transformedMessages : messages;

    if (!pendingUserMessage) return serverMessages;
    if (serverMessages.length === 0) {
      return [pendingUserMessage];
    }
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

  const lastDisplayMessage =
    displayMessages.length > 0
      ? displayMessages[displayMessages.length - 1]
      : null;
  const isWaitingForResponse =
    lastDisplayMessage !== null &&
    (lastDisplayMessage.role === 'user' || !lastDisplayMessage.content.trim());

  // Scroll to bottom when new messages arrive
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
      void uploadFiles(Array.from(files));
    }
    e.target.value = '';
  };

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
      void uploadFiles(imageFiles);
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

    if (!canSendMessage(messageContent, threadId)) {
      return;
    }

    isSendingRef.current = true;

    const clearedAttachments = clearAttachments();
    const attachmentsToSend =
      clearedAttachments.length > 0 ? clearedAttachments : undefined;

    const clientMessageId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const optimisticMessage: Message = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content: messageContent,
      timestamp: new Date(),
      clientMessageId,
    };
    setPendingUserMessage(optimisticMessage);

    setInputValue('');
    setIsLoading(true);

    try {
      let currentThreadId = threadId;
      if (!currentThreadId) {
        const title =
          messageContent.length > 50
            ? `${messageContent.slice(0, 50)}...`
            : messageContent;

        currentThreadId = await createChatThread({
          organizationId,
          title,
          chatType: 'workflow_assistant',
        });
        setThreadId(currentThreadId);

        if (automationId && user?.userId) {
          await updateWorkflowMetadata({
            wfDefinitionId: automationId,
            metadata: { ...workflow?.metadata, threadId: currentThreadId },
            updatedBy: user.userId,
          });
        }
      }

      const mutationAttachments = attachmentsToSend
        ? attachmentsToSend.map((a) => ({
            fileId: a.fileId,
            fileName: a.fileName,
            fileType: a.fileType,
            fileSize: a.fileSize,
          }))
        : undefined;

      if (!currentThreadId) return;

      await chatWithWorkflowAssistant({
        threadId: currentThreadId,
        organizationId,
        workflowId: automationId,
        message: messageContent || analyzeAttachmentsText,
        attachments: mutationAttachments,
      });
    } catch (error) {
      console.error('Error calling workflow assistant:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: errorMessageText,
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
      void handleSendMessage();
    }
  };

  const handleClearChat = useCallback(async () => {
    if (!user?.userId) {
      console.error('User not authenticated');
      return;
    }

    try {
      if (threadId) {
        await deleteChatThread({
          threadId: threadId,
        });
      }

      if (automationId && workflow?.metadata) {
        await updateWorkflowMetadata({
          wfDefinitionId: automationId,
          metadata: { ...workflow.metadata, threadId: null },
          updatedBy: user.userId,
        });
      }

      setThreadId(null);
      setMessages([]);
      setInputValue('');

      onClearChat?.();
    } catch (error) {
      console.error('Error clearing chat:', error);
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

  return {
    workflow,
    displayMessages,
    isLoading,
    isWaitingForResponse,
    inputValue,
    setInputValue,
    attachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    previewImage,
    setPreviewImage,
    containerRef,
    messagesEndRef,
    fileInputRef,
    handleFileInputChange,
    handlePaste,
    handleSendMessage,
    handleKeyDown,
  };
}
