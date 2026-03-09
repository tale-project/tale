'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useCreateThread,
  useDeleteThread,
} from '@/app/features/chat/hooks/mutations';
import {
  useIntegrationApprovals,
  useWorkflowCreationApprovals,
  useWorkflowRunApprovals,
  useHumanInputRequests,
} from '@/app/features/chat/hooks/queries';
import { useChatLoadingState } from '@/app/features/chat/hooks/use-chat-loading-state';
import { useConvexFileUpload } from '@/app/features/chat/hooks/use-convex-file-upload';
import { useMergedChatItems } from '@/app/features/chat/hooks/use-merged-chat-items';
import { useMessageProcessing } from '@/app/features/chat/hooks/use-message-processing';
import { usePendingMessages } from '@/app/features/chat/hooks/use-pending-messages';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useThrottledScroll } from '@/app/hooks/use-throttled-scroll';
import { api } from '@/convex/_generated/api';
import {
  getAcceptForTools,
  getAllAcceptForTools,
  getAllAllowedMimeTypes,
  getAllowedMimeTypesForTools,
  hasFileTools,
} from '@/lib/shared/file-types';

import { useChatLayout } from '../../chat/context/chat-layout-context';
import { useTestAgent } from './mutations';
import { useCustomAgentVersion } from './use-custom-agent-version-context';

const DUPLICATE_WINDOW_MS = 5000;
const recentSends = new Map<string, number>();

function canSendMessage(
  content: string,
  threadId: string | null,
  attachmentsKey: string,
  scopeKey: string,
): boolean {
  const key = `${scopeKey}:${threadId || 'new'}:${attachmentsKey}:${content.trim().toLowerCase()}`;
  const lastSent = recentSends.get(key);
  const now = Date.now();

  if (lastSent && now - lastSent < DUPLICATE_WINDOW_MS) {
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

interface UseTestChatOptions {
  organizationId: string;
  agentId: string;
  onReset?: () => void;
}

export function useTestChat({
  organizationId,
  agentId,
  onReset,
}: UseTestChatOptions) {
  const { agent: currentAgent } = useCustomAgentVersion();

  const hasWorkflowBindings = useMemo(
    () => (currentAgent.workflowBindings?.length ?? 0) > 0,
    [currentAgent.workflowBindings],
  );

  const fileUploadEnabled = useMemo(
    () => hasFileTools(currentAgent.toolNames) || hasWorkflowBindings,
    [currentAgent.toolNames, hasWorkflowBindings],
  );

  const fileAccept = useMemo(
    () =>
      hasWorkflowBindings
        ? getAllAcceptForTools()
        : getAcceptForTools(currentAgent.toolNames),
    [currentAgent.toolNames, hasWorkflowBindings],
  );

  const allowedMimeTypes = useMemo(
    () =>
      hasWorkflowBindings
        ? getAllAllowedMimeTypes()
        : getAllowedMimeTypesForTools(currentAgent.toolNames),
    [currentAgent.toolNames, hasWorkflowBindings],
  );

  const {
    attachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    clearAttachments,
  } = useConvexFileUpload({
    organizationId,
    ...(allowedMimeTypes ? { allowedTypes: allowedMimeTypes } : {}),
  });

  const {
    isPending,
    setIsPending,
    pendingThreadId,
    setPendingThreadId,
    clearChatState,
    setPendingMessage,
  } = useChatLayout();

  const [inputValue, setInputValue] = useState('');
  const [threadId, setThreadId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isSendingRef = useRef(false);
  const { throttledScrollToBottom, cleanup } = useThrottledScroll({
    delay: 16,
  });
  const { mutateAsync: testAgent } = useTestAgent();
  const { mutateAsync: createChatThread } = useCreateThread();
  const { mutateAsync: deleteChatThread } = useDeleteThread();

  const { approvals: integrationApprovals } = useIntegrationApprovals(
    organizationId,
    threadId ?? undefined,
  );
  const { approvals: workflowCreationApprovals } = useWorkflowCreationApprovals(
    organizationId,
    threadId ?? undefined,
  );
  const { approvals: workflowRunApprovals } = useWorkflowRunApprovals(
    organizationId,
    threadId ?? undefined,
  );
  const { requests: humanInputRequests } = useHumanInputRequests(
    organizationId,
    threadId ?? undefined,
  );

  const {
    messages: rawMessages,
    activeMessage,
    terminalAssistantCount,
  } = useMessageProcessing(threadId ?? undefined);

  const messages = usePendingMessages({
    threadId: threadId ?? undefined,
    realMessages: rawMessages,
  });

  const { data: isGenerating } = useConvexQuery(
    api.threads.queries.isThreadGenerating,
    threadId ? { threadId } : 'skip',
  );

  const { isLoading } = useChatLoadingState({
    isPending,
    setIsPending,
    isGenerating: isGenerating ?? false,
    threadId: threadId ?? undefined,
    pendingThreadId,
    terminalAssistantCount,
  });

  const isUploading = uploadingFiles.length > 0;

  const mergedItems = useMergedChatItems({
    messages,
    integrationApprovals,
    workflowCreationApprovals,
    workflowRunApprovals,
    humanInputRequests,
  });

  useEffect(() => {
    if (mergedItems.length === 0) return;
    const rafId = requestAnimationFrame(() => {
      if (containerRef.current) {
        throttledScrollToBottom(containerRef.current, 'auto');
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [mergedItems.length, isLoading, throttledScrollToBottom]);

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
      isUploading ||
      !organizationId
    )
      return;

    const messageContent = inputValue.trim();

    const attachmentsKey =
      attachments.length > 0
        ? attachments
            .map((a) => a.fileId)
            .sort()
            .join(',')
        : 'none';
    const scopeKey = `${organizationId}:${agentId}`;
    if (!canSendMessage(messageContent, threadId, attachmentsKey, scopeKey)) {
      return;
    }

    isSendingRef.current = true;

    const mutationAttachments =
      attachments.length > 0
        ? attachments.map((a) => ({
            fileId: a.fileId,
            fileName: a.fileName,
            fileType: a.fileType,
            fileSize: a.fileSize,
          }))
        : undefined;

    if (attachments.length > 0) {
      clearAttachments();
    }

    const lastMessageKey = rawMessages[rawMessages.length - 1]?.key;

    setPendingThreadId(threadId ?? null);
    setIsPending(true);
    setPendingMessage({
      content: messageContent,
      threadId: threadId ?? 'pending',
      attachments: mutationAttachments?.map((a) => ({
        ...a,
        fileId: String(a.fileId),
      })),
      timestamp: new Date(),
      lastMessageKey,
    });

    setInputValue('');

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
          chatType: 'agent_test',
        });
        setThreadId(currentThreadId);

        setPendingMessage({
          content: messageContent,
          threadId: currentThreadId,
          attachments: mutationAttachments?.map((a) => ({
            ...a,
            fileId: String(a.fileId),
          })),
          timestamp: new Date(),
          lastMessageKey,
        });
      }

      if (!currentThreadId) return;

      await testAgent({
        customAgentId: currentAgent._id,
        threadId: currentThreadId,
        organizationId,
        message: messageContent,
        attachments: mutationAttachments,
      });
    } catch (error) {
      console.error('Error testing draft agent:', error);
      clearChatState();
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

  const handleClearChat = useCallback(() => {
    if (threadId) {
      void deleteChatThread({ threadId }).catch((error) => {
        console.error('Error deleting test chat thread:', error);
      });
    }
    setThreadId(null);
    clearChatState();
    onReset?.();
  }, [threadId, deleteChatThread, clearChatState, onReset]);

  return {
    displayItems: mergedItems,
    isLoading,
    isUploading,
    threadId,
    activeMessage,
    inputValue,
    setInputValue,
    attachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    containerRef,
    messagesEndRef,
    fileInputRef,
    fileUploadEnabled,
    fileAccept,
    handleFileInputChange,
    handlePaste,
    handleSendMessage,
    handleKeyDown,
    handleClearChat,
  };
}
