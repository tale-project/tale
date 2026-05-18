import { useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import { useCallback, useRef, startTransition } from 'react';

import { useConvexClient } from '@/app/hooks/use-convex-client';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

type GuardrailsBlockedCode =
  | 'pii.blocked'
  | 'chat_filter.blocked'
  | 'moderation_provider.blocked';

function extractGuardrailsBlockedCode(
  error: unknown,
): GuardrailsBlockedCode | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  if (typeof data !== 'object' || data === null || !('code' in data)) {
    return null;
  }
  const code = (data as Record<string, unknown>)['code'];
  if (
    code === 'pii.blocked' ||
    code === 'chat_filter.blocked' ||
    code === 'moderation_provider.blocked'
  ) {
    return code;
  }
  return null;
}

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
import { clearSendPending, markSendPending } from './use-pending-send';
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
  enabledCapabilities?: string[];
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
  enabledCapabilities = [],
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
      const mutationAttachments: Array<{
        fileId: Id<'_storage'>;
        fileName: string;
        fileType: string;
        fileSize: number;
      }> =
        attachments?.map((a) => ({
          fileId: a.fileId,
          fileName: a.fileName,
          fileType: a.fileType,
          fileSize: a.fileSize,
        })) ?? [];

      // Bind any completed video-link jobs in this thread to the outgoing
      // message. Atomic — the mutation patches lifecycleStatus='bound'
      // and returns the FileAttachment payloads in one transaction,
      // closing the chip-vs-drain race that the round-2 review (B8/R2)
      // flagged. pastedTokens come back so we can strip raw URLs from
      // the message text (LLM shouldn't see URL + transcript fileId both).
      const pastedTokensToStrip: string[] = [];
      if (threadId) {
        try {
          const bound = await convexClient.mutation(
            api.video_links.mutations.bindCompletedJobsToMessage,
            { organizationId, threadId },
          );
          for (const att of bound) {
            mutationAttachments.push({
              fileId: att.fileId,
              fileName: att.fileName,
              fileType: att.fileType,
              fileSize: att.fileSize,
            });
            pastedTokensToStrip.push(att.pastedToken);
          }
        } catch (err) {
          console.error(
            '[use-send-message] video-link bind failed:',
            err instanceof Error ? err.message : err,
          );
        }
      }

      const currentArena = arenaRef.current;
      const modelA = currentArena?.modelA;
      const modelB = currentArena?.modelB;
      const isArena = currentArena?.isArenaMode && modelA && modelB;

      // Set pending thread scope (null for new-chat page)
      setPendingThreadId(threadId ?? null);
      onBeforeSend?.();

      // Pre-send guardrails check. We await this BEFORE rendering the
      // optimistic bubble so block-mode violations show a toast (and no
      // message ever appears), and so mask-mode rewrites are reflected in
      // the first frame the user sees — otherwise they'd watch their raw
      // input flash for a moment and then get replaced by `[BLOCKED]`.
      // On any error we fall through with the raw text; the server will
      // still re-sanitize authoritatively.
      let messageToSend = message;
      // Strip any pasted video-link URLs from the outgoing text. Literal
      // String.replace per token (not regex over arbitrary URL shapes
      // per the B1 review — regex would mishandle trailing punctuation
      // and credentialed URLs); fall through with the raw text if a
      // token isn't found (user edited it). Collapse runs of whitespace
      // afterwards to clean up double-spaces left behind.
      if (pastedTokensToStrip.length > 0) {
        for (const token of pastedTokensToStrip) {
          if (token && messageToSend.includes(token)) {
            messageToSend = messageToSend.replace(token, '');
          }
        }
        messageToSend = messageToSend.replace(/\s+/g, ' ').trim();
      }
      try {
        const precheck = await convexClient.action(
          api.governance.precheck.precheckInput,
          { organizationId, text: message },
        );
        if (precheck.blocked) {
          clearChatState();
          const title =
            precheck.code === 'pii.blocked'
              ? t('toast.piiBlocked')
              : t('toast.policyViolation');
          // Prefer admin-edited labels resolved server-side; fall back to
          // internal slugs only when the policy was mid-edit and a category
          // got removed between detection and render.
          const labels =
            precheck.categoryLabels && precheck.categoryLabels.length > 0
              ? precheck.categoryLabels
              : precheck.categoryIds;
          const description =
            labels && labels.length > 0 ? labels.join(', ') : undefined;
          toast({ title, description, variant: 'destructive' });
          sendingRef.current = false;
          return;
        }
        if (precheck.maskedText !== undefined) {
          messageToSend = precheck.maskedText;
        }
      } catch (error) {
        console.warn(
          `[use-send-message] guardrails precheck failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      // Show optimistic message AFTER precheck so it reflects any mask
      // rewrite from the server. For orgs without guardrails this is a
      // single cheap query (<50ms typically) — the previous "instant"
      // render was only winning a round-trip anyway.
      const lastMessageKey = messages[messages.length - 1]?.key;
      const pendingTimestamp = new Date();
      if (isArena) {
        if (currentArena.arenaThreadIdA && currentArena.arenaThreadIdB) {
          setPendingMessage({
            content: messageToSend,
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
            content: messageToSend,
            threadId: currentArena.arenaThreadIdA ?? 'pending',
            attachments: mutationAttachments,
            timestamp: pendingTimestamp,
            lastMessageKey,
          });
        }
      } else {
        setPendingMessage({
          content: messageToSend,
          threadId: threadId ?? 'pending',
          attachments: mutationAttachments,
          timestamp: pendingTimestamp,
          lastMessageKey,
        });
      }

      // Track threads we've flagged optimistic-pending so the catch block can
      // clear them regardless of which branch (arena / new-chat / existing)
      // set them, and including any thread IDs created mid-try.
      const pendingThreadIdsLocal = new Set<string>();
      const markPending = (id: string) => {
        pendingThreadIdsLocal.add(id);
        markSendPending(id);
      };

      try {
        if (isArena) {
          // --- Arena mode: Thread A = root, Thread B = branch ---
          const title =
            messageToSend.length > 50
              ? messageToSend.slice(0, 50) + '...'
              : messageToSend;
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
              content: messageToSend,
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

          // Bind pre-thread + in-thread video-link jobs to tIdA. Without
          // this, welcome-page pastes that then switch to arena lose
          // their attachment silently — the early bind at top of the
          // callback gates on `if (threadId)`, and the standard-mode late
          // bind never fires in arena. R2 review B4.
          try {
            const bound = await convexClient.mutation(
              api.video_links.mutations.bindCompletedJobsToMessage,
              { organizationId, threadId: tIdA },
            );
            for (const att of bound) {
              if (mutationAttachments.some((a) => a.fileId === att.fileId))
                continue;
              mutationAttachments.push({
                fileId: att.fileId,
                fileName: att.fileName,
                fileType: att.fileType,
                fileSize: att.fileSize,
              });
              if (att.pastedToken && messageToSend.includes(att.pastedToken)) {
                messageToSend = messageToSend.replace(att.pastedToken, '');
              }
            }
            if (bound.length > 0) {
              messageToSend = messageToSend.replace(/\s+/g, ' ').trim();
            }
          } catch (err) {
            console.error(
              '[use-send-message] arena video-link bind failed:',
              err instanceof Error ? err.message : err,
            );
          }

          // Flip per-thread optimistic spinner IMMEDIATELY so both columns
          // show "Thinking" before the Node action cold-starts. Real
          // isThreadGenerating subscriptions take over once they arrive.
          markPending(tIdA);
          markPending(tIdB);

          // Start both models generating (split view shows "Thinking")
          await arenaChatRef.current({
            agentSlug: selectedAgent.name,
            threadIdA: tIdA,
            threadIdB: tIdB,
            organizationId,
            message: messageToSend,
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
              content: messageToSend,
              threadId: 'pending',
              attachments: mutationAttachments,
              timestamp: pendingTimestamp,
              lastMessageKey,
            });

            const title =
              messageToSend.length > 50
                ? messageToSend.slice(0, 50) + '...'
                : messageToSend;
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
              content: messageToSend,
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
              messageToSend.length > 50
                ? messageToSend.slice(0, 50) + '...'
                : messageToSend;
            await updateThread({ threadId: currentThreadId, title });
          }

          // Bind pre-thread video-link jobs to the just-created (or
          // already-existing) thread. The early bind at the top of this
          // callback gates on `if (threadId)` so it skips welcome-page
          // first-sends entirely — by here we have a real threadId either
          // way, which is the moment to pull pre-thread chips in. Without
          // this second bind, welcome-page video-link pastes lose their
          // attachment and the LLM only sees the raw URL.
          try {
            const bound = await convexClient.mutation(
              api.video_links.mutations.bindCompletedJobsToMessage,
              { organizationId, threadId: currentThreadId },
            );
            for (const att of bound) {
              // Skip duplicates if the earlier in-thread bind already added it.
              if (mutationAttachments.some((a) => a.fileId === att.fileId))
                continue;
              mutationAttachments.push({
                fileId: att.fileId,
                fileName: att.fileName,
                fileType: att.fileType,
                fileSize: att.fileSize,
              });
              if (att.pastedToken && messageToSend.includes(att.pastedToken)) {
                messageToSend = messageToSend.replace(att.pastedToken, '');
              }
            }
            // Re-tidy the message text once after stripping any newly-bound
            // pasted URLs. Cheap; only matters if we actually struck a token.
            if (bound.length > 0) {
              messageToSend = messageToSend.replace(/\s+/g, ' ').trim();
            }
          } catch (err) {
            console.error(
              '[use-send-message] post-thread video-link bind failed:',
              err instanceof Error ? err.message : err,
            );
          }

          // Flip the optimistic spinner IMMEDIATELY — the Node action cold
          // start adds ~100–300 ms before markGenerating commits. Real
          // isThreadGenerating takes over once it arrives.
          markPending(currentThreadId);

          await chatWithAgent({
            agentSlug: selectedAgent.name,
            threadId: currentThreadId,
            organizationId,
            message: messageToSend,
            modelId: modelId || undefined,
            capabilityBindings:
              enabledCapabilities.length > 0 ? enabledCapabilities : undefined,
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
        // Clear every thread we flagged — server either never started the
        // turn (pre-markGenerating throw) or rolled it back. Real state
        // stays authoritative once isThreadGenerating catches up.
        for (const id of pendingThreadIdsLocal) clearSendPending(id);
        clearChatState();
        resetGlobalFreeze();

        const rawMessage =
          error instanceof Error ? error.message : String(error);
        // First-line truncation defends against multi-line stack-like payloads
        // from upstream LLM providers leaking into the toast.
        const errorMessage = rawMessage.split('\n')[0] ?? rawMessage;
        const lower = errorMessage.toLowerCase();

        // Guardrails block detection: prefer structured ConvexError data,
        // fall back to the legacy substring for old server bundles.
        const blockedCode = extractGuardrailsBlockedCode(error);

        let title = t('toast.sendFailed');
        if (
          blockedCode === 'pii.blocked' ||
          errorMessage.includes('Message blocked: PII')
        ) {
          title = t('toast.piiBlocked');
        } else if (
          blockedCode === 'chat_filter.blocked' ||
          blockedCode === 'moderation_provider.blocked' ||
          errorMessage.includes('Message blocked: chat filter') ||
          errorMessage.includes('Message blocked: content policy')
        ) {
          title = t('toast.policyViolation');
        } else if (
          lower.includes('not available for your account') ||
          lower.includes('model access policy') ||
          lower.includes('do not have access to the selected model')
        ) {
          title = t('toast.modelAccessDenied');
        } else if (lower.includes('usage limit') || lower.includes('budget')) {
          title = t('toast.budgetExceeded');
        }

        toast({
          title,
          description: errorMessage,
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
      enabledCapabilities,
      userContext,
      navigate,
      t,
      convexClient,
      teamId,
    ],
  );

  return { sendMessage };
}
