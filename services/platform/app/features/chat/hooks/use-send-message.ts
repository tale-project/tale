import { useNavigate } from '@tanstack/react-router';
import { useCallback, startTransition } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { sanitizeChatMessage } from '@/lib/utils/sanitize-chat';
import { toId } from '@/lib/utils/type-guards';

import type {
  PendingMessage,
  SelectedAgent,
} from '../context/chat-layout-context';
import type { FileAttachment } from '../types';
import type { ChatMessage } from './use-message-processing';

import {
  useChatWithAgent,
  useChatWithBuiltinAgent,
  useChatWithCustomAgent,
  useCreateThread,
  useUpdateThread,
} from './mutations';

interface UseSendMessageParams {
  organizationId: string;
  threadId: string | undefined;
  messages: ChatMessage[];
  setIsPending: (pending: boolean) => void;
  setPendingMessage: (message: PendingMessage | null) => void;
  clearChatState: () => void;
  onBeforeSend?: () => void;
  selectedAgent?: SelectedAgent | null;
}

/**
 * Hook to handle message sending logic.
 * Manages thread creation, title updates, and message mutations.
 */
export function useSendMessage({
  organizationId,
  threadId,
  messages,
  setIsPending,
  setPendingMessage,
  clearChatState,
  onBeforeSend,
  selectedAgent,
}: UseSendMessageParams) {
  const { t } = useT('chat');
  const navigate = useNavigate();

  const createThread = useCreateThread();
  const updateThread = useUpdateThread();
  const chatWithAgent = useChatWithAgent();
  const chatWithBuiltinAgent = useChatWithBuiltinAgent();
  const chatWithCustomAgent = useChatWithCustomAgent();

  const sendMessage = useCallback(
    async (message: string, attachments?: FileAttachment[]) => {
      const sanitizedContent = sanitizeChatMessage(message);

      // Set pending state
      setIsPending(true);
      onBeforeSend?.();

      try {
        let currentThreadId = threadId;
        let isFirstMessage = false;

        // Convert attachments format (needed before storing pending message)
        const mutationAttachments = attachments?.map((a) => ({
          fileId: a.fileId,
          fileName: a.fileName,
          fileType: a.fileType,
          fileSize: a.fileSize,
        }));

        // Create thread if needed
        if (!currentThreadId) {
          // Store pending message immediately for optimistic UI (before API call)
          const pendingTimestamp = new Date();
          setPendingMessage({
            content: sanitizedContent,
            threadId: 'pending',
            attachments: mutationAttachments,
            timestamp: pendingTimestamp,
          });

          const title =
            message.length > 50 ? message.slice(0, 50) + '...' : message;
          const newThreadId = await createThread({
            organizationId,
            title,
            chatType: 'general',
          });
          currentThreadId = newThreadId;
          isFirstMessage = true;

          // Update pending message with real threadId
          setPendingMessage({
            content: sanitizedContent,
            threadId: newThreadId,
            attachments: mutationAttachments,
            timestamp: pendingTimestamp,
          });

          // Use startTransition to prevent Suspense from triggering
          startTransition(() => {
            void navigate({
              to: '/dashboard/$id/chat/$threadId',
              params: { id: organizationId, threadId: newThreadId },
            });
          });
        } else {
          isFirstMessage = messages?.length === 0;
        }

        // Update thread title for first message
        if (isFirstMessage && currentThreadId) {
          const title =
            message.length > 50 ? message.slice(0, 50) + '...' : message;
          await updateThread({ threadId: currentThreadId, title });
        }

        // Send message with optimistic update
        if (selectedAgent?.type === 'custom') {
          await chatWithCustomAgent({
            customAgentId: toId<'customAgents'>(selectedAgent._id),
            threadId: currentThreadId,
            organizationId,
            message: sanitizedContent,
            attachments: mutationAttachments,
          });
        } else if (selectedAgent?.type === 'builtin') {
          await chatWithBuiltinAgent({
            builtinAgentType: selectedAgent._id,
            threadId: currentThreadId,
            organizationId,
            message: sanitizedContent,
            attachments: mutationAttachments,
          });
        } else {
          await chatWithAgent({
            threadId: currentThreadId,
            organizationId,
            message: sanitizedContent,
            attachments: mutationAttachments,
          });
        }
      } catch (error) {
        console.error('Failed to send message:', error);
        clearChatState();
        toast({
          title: t('toast.sendFailed'),
          variant: 'destructive',
        });
      }
    },
    [
      threadId,
      messages?.length,
      organizationId,
      setIsPending,
      setPendingMessage,
      clearChatState,
      onBeforeSend,
      createThread,
      updateThread,
      chatWithAgent,
      chatWithBuiltinAgent,
      chatWithCustomAgent,
      selectedAgent,
      navigate,
      t,
    ],
  );

  return { sendMessage };
}
