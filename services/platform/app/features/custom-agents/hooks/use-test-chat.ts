'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ChatMessage } from '@/app/features/chat/hooks/use-message-processing';

import {
  useCreateThread,
  useDeleteThread,
} from '@/app/features/chat/hooks/mutations';
import {
  useThreadMessages,
  useIntegrationApprovals,
  useWorkflowCreationApprovals,
  useHumanInputRequests,
} from '@/app/features/chat/hooks/queries';
import { useConvexFileUpload } from '@/app/features/chat/hooks/use-convex-file-upload';
import { useMergedChatItems } from '@/app/features/chat/hooks/use-merged-chat-items';
import { useThrottledScroll } from '@/app/hooks/use-throttled-scroll';

import type { FilePart, Message } from '../components/test-chat-panel/types';

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
  errorMessageText: string;
}

export function useTestChat({
  organizationId,
  agentId,
  onReset,
  errorMessageText,
}: UseTestChatOptions) {
  const {
    attachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    clearAttachments,
  } = useConvexFileUpload();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isSendingRef = useRef(false);
  const [previewImage, setPreviewImage] = useState<{
    isOpen: boolean;
    src: string;
    alt: string;
  } | null>(null);
  const { throttledScrollToBottom, cleanup } = useThrottledScroll({
    delay: 16,
  });

  const { agent: currentAgent } = useCustomAgentVersion();
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
  const { requests: humanInputRequests } = useHumanInputRequests(
    organizationId,
    threadId ?? undefined,
  );

  const uiMessages = useThreadMessages(threadId);

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

        return {
          id: m.id,
          key: m.key,
          role: m.role,
          content: m.text,
          timestamp: new Date(m._creationTime),
          _creationTime: m._creationTime,
          fileParts: fileParts.length > 0 ? fileParts : undefined,
        };
      });
  }, [uiMessages]);

  const messagesKey = useMemo(() => {
    return transformedMessages
      .map((m) => `${m.id}:${m.content.length}`)
      .join('|');
  }, [transformedMessages]);

  const isAgentResponding = useMemo(() => {
    if (!uiMessages?.length) return false;
    return uiMessages.some(
      (m) =>
        m.role === 'assistant' &&
        (m.status === 'streaming' || m.status === 'pending'),
    );
  }, [uiMessages]);

  const isUploading = uploadingFiles.length > 0;
  const isBusy = isLoading || isAgentResponding;

  const [pendingUserMessage, setPendingUserMessage] = useState<Message | null>(
    null,
  );
  const pendingUserMessageRef = useRef(pendingUserMessage);
  pendingUserMessageRef.current = pendingUserMessage;
  const transformedMessagesRef = useRef(transformedMessages);
  transformedMessagesRef.current = transformedMessages;

  // Bridge the loading gap
  useEffect(() => {
    if (!isLoading) return;

    if (isAgentResponding) {
      setIsLoading(false);
      return;
    }

    if (!pendingUserMessage && transformedMessages.length > 0) {
      const last = transformedMessages[transformedMessages.length - 1];
      if (last.role === 'assistant') {
        setIsLoading(false);
        return;
      }
    }

    const timeout = setTimeout(() => {
      setIsLoading(false);
    }, 120_000);
    return () => clearTimeout(timeout);
  }, [isLoading, isAgentResponding, pendingUserMessage, transformedMessages]);

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

  const effectiveMessages = useMemo(
    (): ChatMessage[] =>
      transformedMessages.length > 0 ? transformedMessages : messages,
    [transformedMessages, messages],
  );

  const mergedItems = useMergedChatItems({
    messages: effectiveMessages,
    integrationApprovals,
    workflowCreationApprovals,
    humanInputRequests,
  });

  const displayItems = useMemo(() => {
    if (!pendingUserMessage) return mergedItems;
    if (mergedItems.length === 0) {
      return [
        {
          type: 'message' as const,
          data: { ...pendingUserMessage, key: pendingUserMessage.key },
        },
      ];
    }
    const pendingTimestamp = pendingUserMessage.timestamp.getTime();
    const toleranceMs = 60000;
    const pendingContent = pendingUserMessage.content.trim().toLowerCase();

    const hasMatchingServerMessage = mergedItems.some(
      (item) =>
        item.type === 'message' &&
        item.data.role === 'user' &&
        (Math.abs(item.data.timestamp.getTime() - pendingTimestamp) <
          toleranceMs ||
          item.data.content.trim().toLowerCase() === pendingContent),
    );
    if (!hasMatchingServerMessage) {
      return [
        ...mergedItems,
        {
          type: 'message' as const,
          data: { ...pendingUserMessage, key: pendingUserMessage.key },
        },
      ];
    }
    return mergedItems;
  }, [mergedItems, pendingUserMessage]);

  useEffect(() => {
    if (displayItems.length === 0) return;
    if (containerRef.current) {
      throttledScrollToBottom(containerRef.current, 'auto');
    }
  }, [
    displayItems.length,
    messagesKey,
    isAgentResponding,
    throttledScrollToBottom,
  ]);

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
      isBusy ||
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

    const pendingId = `pending-${Date.now()}`;
    const optimisticMessage: Message = {
      id: pendingId,
      key: pendingId,
      role: 'user',
      content: messageContent,
      timestamp: new Date(),
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
          chatType: 'agent_test',
        });
        setThreadId(currentThreadId);
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
      setIsLoading(false);
      const errorId = (Date.now() + 1).toString();
      const errorMessage: Message = {
        id: errorId,
        key: errorId,
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

  const handleClearChat = useCallback(() => {
    if (threadId) {
      void deleteChatThread({ threadId }).catch((error) => {
        console.error('Error deleting test chat thread:', error);
      });
    }
    onReset?.();
  }, [threadId, deleteChatThread, onReset]);

  return {
    displayItems,
    isBusy,
    isUploading,
    threadId,
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
    handleClearChat,
  };
}
