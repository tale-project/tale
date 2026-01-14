import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { sanitizeChatMessage } from '@/lib/utils/sanitize-chat';
import { useCreateThread } from './use-create-thread';
import { useUpdateThread } from './use-update-thread';
import { useChatWithAgent } from './use-chat-with-agent';
import type { FileAttachment } from '../layout';
import type { ChatMessage } from './use-message-processing';

interface UseSendMessageParams {
  organizationId: string;
  threadId: string | undefined;
  messages: ChatMessage[];
  setIsPending: (pending: boolean) => void;
  clearChatState: () => void;
  onBeforeSend?: () => void;
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
  clearChatState,
  onBeforeSend,
}: UseSendMessageParams) {
  const { t } = useT('chat');
  const router = useRouter();

  const createThread = useCreateThread();
  const updateThread = useUpdateThread();
  const chatWithAgent = useChatWithAgent();

  const sendMessage = useCallback(
    async (message: string, attachments?: FileAttachment[]) => {
      const sanitizedContent = sanitizeChatMessage(message);

      // Set pending state
      setIsPending(true);
      onBeforeSend?.();

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
          isFirstMessage = messages?.length === 0;
        }

        // Update thread title for first message
        if (isFirstMessage && currentThreadId) {
          const title =
            message.length > 50 ? message.substring(0, 50) + '...' : message;
          await updateThread({ threadId: currentThreadId, title });
        }

        // Convert attachments format
        const mutationAttachments = attachments?.map((a) => ({
          fileId: a.fileId,
          fileName: a.fileName,
          fileType: a.fileType,
          fileSize: a.fileSize,
        }));

        // Send message with optimistic update
        await chatWithAgent({
          threadId: currentThreadId,
          organizationId,
          message: sanitizedContent,
          attachments: mutationAttachments,
        });
      } catch (error) {
        clearChatState();
        toast({
          title: error instanceof Error ? error.message : t('toast.sendFailed'),
          variant: 'destructive',
        });
      }
    },
    [
      threadId,
      messages?.length,
      organizationId,
      setIsPending,
      clearChatState,
      onBeforeSend,
      createThread,
      updateThread,
      chatWithAgent,
      router,
      t,
    ],
  );

  return { sendMessage };
}
