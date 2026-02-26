import { useNavigate } from '@tanstack/react-router';
import { useCallback, startTransition } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { sanitizeChatMessage } from '@/lib/utils/sanitize-chat';

import type {
  PendingMessage,
  SelectedAgent,
} from '../context/chat-layout-context';
import type { FileAttachment } from '../types';
import type { ChatMessage } from './use-message-processing';

import {
  useUnifiedChatWithAgent,
  useCreateThread,
  useUpdateThread,
} from './mutations';

interface UseSendMessageParams {
  organizationId: string;
  threadId: string | undefined;
  messages: ChatMessage[];
  setIsPending: (pending: boolean) => void;
  setPendingThreadId: (threadId: string | null) => void;
  setPendingMessage: (message: PendingMessage | null) => void;
  clearChatState: () => void;
  onBeforeSend?: () => void;
  selectedAgent: SelectedAgent | null;
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
  setPendingThreadId,
  setPendingMessage,
  clearChatState,
  onBeforeSend,
  selectedAgent,
}: UseSendMessageParams) {
  const { t } = useT('chat');
  const navigate = useNavigate();

  const { mutateAsync: createThread } = useCreateThread();
  const { mutateAsync: updateThread } = useUpdateThread();
  const { mutateAsync: chatWithAgent } = useUnifiedChatWithAgent();

  const sendMessage = useCallback(
    async (message: string, attachments?: FileAttachment[]) => {
      if (!selectedAgent) {
        toast({
          title: t('toast.sendFailed'),
          variant: 'destructive',
        });
        return;
      }

      const sanitizedContent = sanitizeChatMessage(message);

      // Convert attachments format (needed before storing pending message)
      const mutationAttachments = attachments?.map((a) => ({
        fileId: a.fileId,
        fileName: a.fileName,
        fileType: a.fileType,
        fileSize: a.fileSize,
      }));

      // Capture baseline BEFORE setting any state — deterministic snapshot at send time
      const pendingTimestamp = new Date();
      const userMessageBaseline =
        messages?.filter((m) => m.role === 'user').length ?? 0;

      // Set optimistic message FIRST so it renders with/before loading indicator
      setPendingMessage({
        content: sanitizedContent,
        threadId: threadId ?? 'pending',
        attachments: mutationAttachments,
        timestamp: pendingTimestamp,
        userMessageBaseline,
      });

      // Set pending state scoped to this thread (null for new-chat page)
      setPendingThreadId(threadId ?? null);
      setIsPending(true);
      onBeforeSend?.();

      try {
        let currentThreadId = threadId;
        let isFirstMessage = false;

        // Create thread if needed
        if (!currentThreadId) {
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
            userMessageBaseline,
          });

          // Use startTransition to prevent Suspense from triggering.
          // Batch setPendingThreadId with navigate so React renders atomically
          // on the new route — no intermediate render on new-chat with mismatched threadId.
          startTransition(() => {
            setPendingThreadId(newThreadId);
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

        // Send message via unified agent chat mutation
        await chatWithAgent({
          agentId: toId<'customAgents'>(selectedAgent._id),
          threadId: currentThreadId,
          organizationId,
          message: sanitizedContent,
          attachments: mutationAttachments,
        });
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
      messages,
      organizationId,
      setIsPending,
      setPendingThreadId,
      setPendingMessage,
      clearChatState,
      onBeforeSend,
      createThread,
      updateThread,
      chatWithAgent,
      selectedAgent,
      navigate,
      t,
    ],
  );

  return { sendMessage };
}
