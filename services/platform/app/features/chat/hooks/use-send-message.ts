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

  // Simple ref guard to prevent double-send during the async gap
  const sendingRef = useRef(false);

  const sendMessage = useCallback(
    async (message: string, attachments?: FileAttachment[]) => {
      if (sendingRef.current) return;
      if (!selectedAgent) {
        toast({
          title: t('toast.sendFailed'),
          variant: 'destructive',
        });
        return;
      }

      sendingRef.current = true;

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

      // Set pending thread scope (null for new-chat page)
      setPendingThreadId(threadId ?? null);
      onBeforeSend?.();

      // Show optimistic message SYNCHRONOUSLY before any network calls
      // (PII check, thread creation) so the UI updates instantly.
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
      } else {
        // Standard mode: show optimistic message SYNCHRONOUSLY before PII check
        setPendingMessage({
          content: message,
          threadId: threadId ?? 'pending',
          attachments: mutationAttachments,
          timestamp: pendingTimestamp,
          lastMessageKey,
        });
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

          if (currentArena.arenaThreadIdA && currentArena.arenaThreadIdB) {
            // Both threads exist — reuse.
            // Thread B is pre-created when arena mode is enabled, so this
            // is the normal path for both first and subsequent messages.
            tIdA = currentArena.arenaThreadIdA;
            tIdB = currentArena.arenaThreadIdB;
          } else {
            // New chat — create BOTH threads before navigating so that
            // the arena-setup effect in chat-interface sees arenaThreadIdB
            // already set and skips duplicate creation.
            const newA = await createThread({
              organizationId,
              title,
              chatType: 'general',
              arenaGroupId,
              arenaModelId: modelA,
              teamId,
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

            tIdA = newA;
            tIdB = newB;
            currentArena.setArenaThreadIdA(newA);
            currentArena.setArenaThreadIdB(newB);
            setPendingThreadId(tIdA);
            setPendingMessage({
              content: message,
              threadId: tIdA,
              arenaThreadIdB: tIdB,
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
            // History is copied when Thread B is created (arena enable),
            // not at send time — no need to copy again.
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
            // Optimistic message already set before PII check
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
      } finally {
        sendingRef.current = false;
      }
    },
    [
      threadId,
      messages,
      organizationId,
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
