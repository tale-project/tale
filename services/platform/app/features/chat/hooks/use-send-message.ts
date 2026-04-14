import { useNavigate } from '@tanstack/react-router';
import { useCallback, useRef, startTransition } from 'react';

import { useConvexClient } from '@/app/hooks/use-convex-client';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { scrubPii } from '@/convex/governance/pii';
import { useT } from '@/lib/i18n/client';
import { piiConfigSchema } from '@/lib/shared/schemas/governance';

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
  teamId?: string;
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
  teamId,
}: UseSendMessageParams) {
  const { t } = useT('chat');
  const navigate = useNavigate();

  const { mutateAsync: createThread } = useCreateThread();
  const { mutateAsync: updateThread } = useUpdateThread();
  const { mutateAsync: chatWithAgent } = useUnifiedChatWithAgent();
  const { mutateAsync: arenaChatAction } = useArenaChat();
  const convexClient = useConvexClient();

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

      // Convert attachments format (synchronous — needed for optimistic message)
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

      // Set pending state scoped to this thread (null for new-chat page)
      setPendingThreadId(threadId ?? null);
      setIsPending(true);
      onBeforeSend?.();

      // For arena mode, show optimistic message SYNCHRONOUSLY before any
      // network calls (PII check, thread creation) so the UI updates instantly.
      const lastMessageKey = messages[messages.length - 1]?.key;
      const pendingTimestamp = new Date();
      if (isArena) {
        if (currentArena.arenaThreadIdA && currentArena.arenaThreadIdB) {
          setPendingMessage({
            content: message,
            threadId: currentArena.arenaThreadIdA,
            arenaThreadIdB: currentArena.arenaThreadIdB,
            attachments: mutationAttachments,
            timestamp: pendingTimestamp,
            lastMessageKey,
          });
        } else {
          // Thread A may exist (arenaThreadIdA set) but B needs creation,
          // or neither exists yet (new chat). Use the known A ID so
          // ArenaColumn A can match and display the optimistic message.
          setPendingMessage({
            content: message,
            threadId: currentArena.arenaThreadIdA ?? 'pending',
            attachments: mutationAttachments,
            timestamp: pendingTimestamp,
            lastMessageKey,
          });
        }
      }

      // Pre-check PII policy before creating thread
      try {
        const piiPolicy = await convexClient.query(
          api.governance.queries.getPolicy,
          { organizationId, policyType: 'pii_config' as const },
        );
        if (piiPolicy?.enabled && piiPolicy.config) {
          const parsed = piiConfigSchema.safeParse({
            ...piiPolicy.config,
            enabled: piiPolicy.enabled,
          });
          if (parsed.success && parsed.data.mode === 'block') {
            scrubPii(message, parsed.data);
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('Message blocked: PII')) {
          clearChatState();
          toast({
            title: t('toast.piiBlocked'),
            description: errorMessage,
            variant: 'destructive',
          });
          return;
        }
      }

      try {
        if (isArena) {
          // --- Arena mode: Thread A = root, Thread B = branch ---
          const title =
            message.length > 50 ? message.slice(0, 50) + '...' : message;
          const arenaGroupId = crypto.randomUUID();

          let tIdA: string;
          let tIdB: string;
          let needsCopyHistory = false;

          if (currentArena.arenaThreadIdA && currentArena.arenaThreadIdB) {
            // Both threads exist — reuse (subsequent messages in arena)
            tIdA = currentArena.arenaThreadIdA;
            tIdB = currentArena.arenaThreadIdB;
          } else if (currentArena.arenaThreadIdA) {
            // Thread A exists (existing thread) — only create B as branch
            tIdA = currentArena.arenaThreadIdA;
            needsCopyHistory = true;
            const newB = await createThread({
              organizationId,
              title,
              chatType: 'general',
              arenaGroupId,
              arenaModelId: modelB,
              isBranch: true,
              forkedFrom: tIdA,
              teamId,
            });
            tIdB = newB;
            currentArena.setArenaThreadIdB(newB);

            // Update pending message with real thread IDs
            setPendingMessage({
              content: message,
              threadId: tIdA,
              arenaThreadIdB: tIdB,
              attachments: mutationAttachments,
              timestamp: pendingTimestamp,
              lastMessageKey,
            });
          } else {
            // New chat — create threads progressively.
            // Navigate after Thread A so split view renders while B is created.
            const newA = await createThread({
              organizationId,
              title,
              chatType: 'general',
              arenaGroupId,
              arenaModelId: modelA,
              teamId,
            });

            tIdA = newA;
            currentArena.setArenaThreadIdA(newA);
            setPendingThreadId(tIdA);
            setPendingMessage({
              content: message,
              threadId: tIdA,
              attachments: mutationAttachments,
              timestamp: pendingTimestamp,
              lastMessageKey,
            });
            startTransition(() => {
              void navigate({
                to: '/dashboard/$id/chat/$threadId',
                params: { id: organizationId, threadId: tIdA },
              });
            });

            const newB = await createThread({
              organizationId,
              title,
              chatType: 'general',
              arenaGroupId,
              arenaModelId: modelB,
              isBranch: true,
              forkedFrom: newA,
              teamId,
            });

            tIdB = newB;
            currentArena.setArenaThreadIdB(newB);

            // Update pending message with both thread IDs
            setPendingMessage({
              content: message,
              threadId: tIdA,
              arenaThreadIdB: tIdB,
              attachments: mutationAttachments,
              timestamp: pendingTimestamp,
              lastMessageKey,
            });
          }

          // Navigate for existing-thread branches (new-chat navigated above)
          if (currentArena.arenaThreadIdA) {
            setPendingThreadId(tIdA);
            startTransition(() => {
              void navigate({
                to: '/dashboard/$id/chat/$threadId',
                params: { id: organizationId, threadId: tIdA },
              });
            });
          }

          // Start both models generating (split view shows "Thinking")
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
            copyHistoryToB: needsCopyHistory || undefined,
          });
        } else {
          // --- Standard mode: send to one model ---
          let currentThreadId = threadId;
          let isFirstMessage = false;

          if (!currentThreadId) {
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
              teamId,
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

        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const isPiiBlocked = errorMessage.includes('Message blocked: PII');

        toast({
          title: isPiiBlocked ? t('toast.piiBlocked') : t('toast.sendFailed'),
          description: isPiiBlocked ? errorMessage : undefined,
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
      convexClient,
      teamId,
    ],
  );

  return { sendMessage };
}
