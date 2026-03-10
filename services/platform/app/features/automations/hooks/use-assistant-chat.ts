'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useCreateThread,
  useUnifiedChatWithAgent,
} from '@/app/features/chat/hooks/mutations';
import {
  useThreadMessages,
  useWorkflowCreationApprovals,
  useWorkflowUpdateApprovals,
} from '@/app/features/chat/hooks/queries';
import { useConvexFileUpload } from '@/app/features/chat/hooks/use-convex-file-upload';
import {
  extractFileAttachments,
  stripInternalFileReferences,
} from '@/app/features/chat/hooks/use-message-processing';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useThrottledScroll } from '@/app/hooks/use-throttled-scroll';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { stripWorkflowContext } from '@/lib/utils/message-helpers';

import type {
  FilePart,
  Message,
} from '../components/automation-assistant/types';

import { useUpdateAutomationMetadata } from './mutations';
import { useWorkflow } from './queries';

// Module-level guard to prevent duplicate sends (survives component remounts)
const recentSends = new Map<string, number>();
const DUPLICATE_WINDOW_MS = 5000;
const SAFETY_TIMEOUT_MS = 60_000;

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
  errorMessageText: string;
  analyzeAttachmentsText: string;
}

export function useAssistantChat({
  automationId,
  organizationId,
  errorMessageText,
  analyzeAttachmentsText,
}: UseAssistantChatOptions) {
  const {
    attachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    clearAttachments,
  } = useConvexFileUpload({ organizationId });
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isPending, setIsPending] = useState(false);
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

  // Resolve workflow agent ID via system default slug
  const { data: workflowAgentId } = useConvexQuery(
    api.custom_agents.queries.getSystemAgentBySlug,
    organizationId ? { organizationId, systemAgentSlug: 'workflow' } : 'skip',
  );

  const { mutateAsync: chatWithAgent } = useUnifiedChatWithAgent();
  const { mutateAsync: createChatThread } = useCreateThread();
  const { mutateAsync: updateWorkflowMetadata } = useUpdateAutomationMetadata();

  const { data: workflow } = useWorkflow(automationId);

  const uiMessages = useThreadMessages(threadId);
  const { approvals: workflowUpdateApprovals } = useWorkflowUpdateApprovals(
    organizationId,
    threadId ?? undefined,
  );
  const { approvals: workflowCreationApprovals } = useWorkflowCreationApprovals(
    organizationId,
    threadId ?? undefined,
  );

  // Server-side loading state: is the agent currently generating?
  const { data: isGenerating } = useConvexQuery(
    api.threads.queries.isThreadGenerating,
    threadId ? { threadId } : 'skip',
  );

  // Dual-layer loading: isPending (optimistic) + isGenerating (server reactive)
  const isLoading = isPending || (isGenerating ?? false);

  // Handoff: clear isPending once isGenerating takes over
  useEffect(() => {
    if (isPending && isGenerating) {
      setIsPending(false);
    }
  }, [isPending, isGenerating]);

  // Safety timeout: clear isPending after max lifetime
  useEffect(() => {
    if (!isPending) return;
    const timeout = setTimeout(() => setIsPending(false), SAFETY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [isPending]);

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
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const parts: unknown[] = Array.isArray(m.parts) ? m.parts : [];
        const fileParts = parts
          .filter(
            (p): p is FilePart =>
              typeof p === 'object' &&
              p !== null &&
              'type' in p &&
              p.type === 'file' &&
              'url' in p &&
              typeof p.url === 'string' &&
              'mediaType' in p &&
              typeof p.mediaType === 'string',
          )
          .map((p) => ({
            type: 'file' as const,
            mediaType: p.mediaType,
            filename: p.filename,
            url: p.url,
          }));

        const rawText = m.text;
        const fileAttachments =
          m.role === 'user' && rawText
            ? extractFileAttachments(rawText)
            : undefined;

        return {
          id: m.id,
          role: m.role,
          content: rawText
            ? stripInternalFileReferences(
                m.role === 'user' ? stripWorkflowContext(rawText) : rawText,
              )
            : '',
          timestamp: new Date(m._creationTime),
          fileParts: fileParts.length > 0 ? fileParts : undefined,
          attachments:
            fileAttachments && fileAttachments.length > 0
              ? fileAttachments
              : undefined,
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
  const pendingUserMessageRef = useRef(pendingUserMessage);
  pendingUserMessageRef.current = pendingUserMessage;
  const transformedMessagesRef = useRef(transformedMessages);
  transformedMessagesRef.current = transformedMessages;

  // Sync messages from thread
  useEffect(() => {
    const currentTransformed = transformedMessagesRef.current;
    const currentPending = pendingUserMessageRef.current;
    if (currentTransformed.length > 0) {
      setMessages(currentTransformed);
      if (currentPending) {
        const pendingTimestamp = currentPending.timestamp.getTime();
        const toleranceMs = 60000;
        const pendingContent = currentPending.content.trim().toLowerCase();
        const hasMatchingServerMessage = currentTransformed.some(
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
    isLoading ||
    (lastDisplayMessage !== null &&
      (lastDisplayMessage.role === 'user' ||
        !lastDisplayMessage.content.trim()));

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

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        void uploadFiles(Array.from(files));
      }
      e.target.value = '';
    },
    [uploadFiles],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
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
    },
    [uploadFiles],
  );

  const handleSendMessage = async () => {
    if (isSendingRef.current) return;
    if (
      (!inputValue.trim() && attachments.length === 0) ||
      isLoading ||
      !organizationId ||
      !workflowAgentId
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
      attachments: attachmentsToSend,
    };
    setPendingUserMessage(optimisticMessage);

    setInputValue('');
    setIsPending(true);

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

      await chatWithAgent({
        agentId: workflowAgentId,
        threadId: currentThreadId,
        organizationId,
        message: messageContent || analyzeAttachmentsText,
        attachments: mutationAttachments,
        additionalContext: automationId
          ? {
              target_workflow_id: String(automationId),
              target_workflow_name: workflow?.name ?? '',
            }
          : undefined,
      });
    } catch (error) {
      console.error('Error calling workflow assistant:', error);
      setIsPending(false);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: errorMessageText,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      isSendingRef.current = false;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

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
    workflowUpdateApprovals,
    workflowCreationApprovals,
  };
}
