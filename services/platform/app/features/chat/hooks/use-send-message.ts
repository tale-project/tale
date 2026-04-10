import { useNavigate } from '@tanstack/react-router';
import { useCallback, useRef, startTransition } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import type {
  PendingMessage,
  SelectedAgent,
} from '../context/chat-layout-context';
import type { FileAttachment } from '../types';
import {
  useUnifiedChatWithAgent,
  useArenaChat,
  useCreateThread,
  useUpdateThread,
} from './mutations';
import type { ChatMessage } from './use-message-processing';
import { resetGlobalFreeze } from './use-stream-buffer';
import type { UserContext } from './use-user-context';

interface ArenaParams {
  isArenaMode: boolean;
  modelA: string | null;
  modelB: string | null;
  arenaThreadIdA: string | null;
  arenaThreadIdB: string | null;
  setArenaThreadIdA: (threadId: string | null) => void;
  setArenaThreadIdB: (threadId: string | null) => void;
}

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
  modelId?: string;
  userContext?: UserContext;
  arena?: ArenaParams;
}

/**
 * Hook to handle message sending logic.
 * Manages thread creation, title updates, and message mutations.
 * Supports arena mode for A/B model comparison.
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
  modelId,
  userContext,
  arena,
}: UseSendMessageParams) {
  const { t } = useT('chat');
  const navigate = useNavigate();

  const { mutateAsync: createThread } = useCreateThread();
  const { mutateAsync: updateThread } = useUpdateThread();
  const { mutateAsync: chatWithAgent } = useUnifiedChatWithAgent();
  const { mutateAsync: arenaChatAction } = useArenaChat();

  // Use refs for arena params to avoid destabilizing the sendMessage callback
  const arenaRef = useRef(arena);
  arenaRef.current = arena;
  const arenaChatRef = useRef(arenaChatAction);
  arenaChatRef.current = arenaChatAction;

  const sendMessage = useCallback(
    async (message: string, attachments?: FileAttachment[]) => {
      if (!selectedAgent) {
        toast({
          title: t('toast.sendFailed'),
          variant: 'destructive',
        });
        return;
      }

      // Set pending state scoped to this thread (null for new-chat page)
      setPendingThreadId(threadId ?? null);
      setIsPending(true);
      onBeforeSend?.();

      try {
        // Convert attachments format
        const mutationAttachments = attachments?.map((a) => ({
          fileId: a.fileId,
          fileName: a.fileName,
          fileType: a.fileType,
          fileSize: a.fileSize,
        }));

        const currentArena = arenaRef.current;
        const modelA = currentArena?.modelA;
        const modelB = currentArena?.modelB;
        const isArena = currentArena?.isArenaMode && modelA && modelB;

        if (isArena) {
          // --- Arena mode: Thread A = root, Thread B = branch ---
          const title =
            message.length > 50 ? message.slice(0, 50) + '...' : message;
          const arenaGroupId = crypto.randomUUID();

          let tIdA: string;
          let tIdB: string;

          if (currentArena.arenaThreadIdA && currentArena.arenaThreadIdB) {
            tIdA = currentArena.arenaThreadIdA;
            tIdB = currentArena.arenaThreadIdB;
          } else {
            // Create Thread A first (root)
            const newA = await createThread({
              organizationId,
              title,
              chatType: 'general',
              arenaGroupId,
              arenaModelId: modelA,
            });

            // Create Thread B as a branch of A
            const newB = await createThread({
              organizationId,
              title,
              chatType: 'general',
              arenaGroupId,
              arenaModelId: modelB,
              isBranch: true,
              forkedFrom: newA,
            });

            tIdA = newA;
            tIdB = newB;
            currentArena.setArenaThreadIdA(newA);
            currentArena.setArenaThreadIdB(newB);

            // Navigate to Thread A (the root) so it's the "main" thread
            startTransition(() => {
              setPendingThreadId(newA);
              void navigate({
                to: '/dashboard/$id/chat/$threadId',
                params: { id: organizationId, threadId: newA },
              });
            });
          }

          setPendingMessage({
            content: message,
            threadId: tIdA,
            attachments: mutationAttachments,
            timestamp: new Date(),
            lastMessageKey: messages[messages.length - 1]?.key,
          });

          await arenaChatRef.current({
            agentSlug: selectedAgent.name,
            orgSlug: 'default',
            threadIdA: tIdA,
            threadIdB: tIdB,
            organizationId,
            message,
            modelIdA: modelA,
            modelIdB: modelB,
            attachments: mutationAttachments,
            userContext: userContext
              ? {
                  timezone: userContext.timezone,
                  language: userContext.language,
                }
              : undefined,
          });
        } else {
          // --- Standard mode: send to one model ---
          let currentThreadId = threadId;
          let isFirstMessage = false;

          const lastMessageKey = messages[messages.length - 1]?.key;

          if (!currentThreadId) {
            const pendingTimestamp = new Date();
            setPendingMessage({
              content: message,
              threadId: 'pending',
              attachments: mutationAttachments,
              timestamp: pendingTimestamp,
              lastMessageKey,
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

            // Update pending state synchronously (high priority) so that
            // ThreadGate sees pendingThreadId immediately and skips the
            // skeleton. usePendingMessages matches via the pendingThreadId
            // fallback path even while URL is still /chat.
            // Only navigation is deferred via startTransition.
            setPendingMessage({
              content: message,
              threadId: newThreadId,
              attachments: mutationAttachments,
              timestamp: pendingTimestamp,
              lastMessageKey,
            });
            setPendingThreadId(newThreadId);
            startTransition(() => {
              void navigate({
                to: '/dashboard/$id/chat/$threadId',
                params: { id: organizationId, threadId: newThreadId },
              });
            });
          } else {
            setPendingMessage({
              content: message,
              threadId: currentThreadId,
              attachments: mutationAttachments,
              timestamp: new Date(),
              lastMessageKey,
            });
            isFirstMessage = messages?.length === 0;
          }

          if (isFirstMessage && currentThreadId) {
            const title =
              message.length > 50 ? message.slice(0, 50) + '...' : message;
            await updateThread({ threadId: currentThreadId, title });
          }

          await chatWithAgent({
            agentSlug: selectedAgent.name,
            orgSlug: 'default',
            threadId: currentThreadId,
            organizationId,
            message,
            modelId: modelId || undefined,
            attachments: mutationAttachments,
            userContext: userContext
              ? {
                  timezone: userContext.timezone,
                  language: userContext.language,
                }
              : undefined,
          });
        }
      } catch (error) {
        console.error('Failed to send message:', error);
        clearChatState();
        resetGlobalFreeze();
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
      modelId,
      userContext,
      navigate,
      t,
    ],
  );

  return { sendMessage };
}
