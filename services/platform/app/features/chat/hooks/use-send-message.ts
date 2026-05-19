import { useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import {
  useCallback,
  useRef,
  startTransition,
  type MutableRefObject,
} from 'react';

import { useConvexClient } from '@/app/hooks/use-convex-client';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { formatVideoLinkAttachmentMarkdown } from '@/lib/shared/video-link-markdown';

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
  // After the `'code' in data` narrowing, TS infers
  // `data: object & Record<'code', unknown>`, so direct access is
  // type-safe — no cast required.
  const code = data.code;
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
import type { VideoLinkJob } from './use-chat-video-links';
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
  /**
   * Auto-scroll intent ref owned by chat-interface.tsx. The hook sets it
   * IMMEDIATELY before each `setPendingMessage(...)` so the intent is
   * fresh when the MutationObserver picks up the new bubble.
   *
   * Why this is per-`setPendingMessage` rather than once at entry:
   * `bindCompletedJobsToMessage` for video-link attachments awaits a
   * 50-200 ms server round-trip BEFORE the optimistic message lands. If
   * the caller sets the intent before that await, any unrelated
   * Resize/MutationObserver fire during the wait downgrades 'smooth'
   * → 'instant' (chat-interface.tsx:549-552), or worse, an `onScroll`
   * with `currentTop < prevTop` clears it to null (line 546). By the
   * time the optimistic bubble actually mounts, the intent is gone and
   * auto-scroll-to-bottom doesn't fire — visible as "scroll didn't
   * follow after sending a video link" while plain text / images work
   * (those paths skip the bind round-trip).
   */
  scrollIntentRef?: MutableRefObject<ScrollBehavior | null>;
  /**
   * Restore the composer chips for the given videoLinkJob ids. Called from
   * inside `sendMessage` when bind or downstream `chatWithAgent` throws so
   * the chips the caller hid synchronously on click-time reappear in the
   * composer. Pair with the click-side `markJobsSent` exposed by
   * `useChatVideoLinks` — see chat-interface.tsx for the click-side hide.
   * Without this rollback the chips stay invisible forever (they were
   * hidden by a client-side Set, not by `messageBoundAt`) and the user
   * loses both the typed text AND every transcript attachment on a
   * failed send.
   */
  unmarkJobsSent?: (jobIds: Array<Id<'videoLinkJobs'>>) => void;
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
  scrollIntentRef,
  unmarkJobsSent,
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
    async (
      message: string,
      attachments?: FileAttachment[],
      videoLinkSnapshot?: VideoLinkJob[],
    ) => {
      if (sendingRef.current) return;
      if (!selectedAgent) {
        toast({
          title: t('toast.sendFailed'),
          variant: 'destructive',
        });
        return;
      }

      sendingRef.current = true;

      // Set the auto-scroll-to-bottom intent IMMEDIATELY before any
      // setPendingMessage call. See `UseSendMessageParams.scrollIntentRef`
      // docstring — setting it once at the outer `handleSendMessage`
      // entry (before this hook's awaits) lets unrelated observer
      // fires downgrade/clear the ref during long awaits (e.g. the
      // video-link `bindCompletedJobsToMessage` round-trip), so by the
      // time the optimistic bubble lands, scroll doesn't fire.
      const markScrollIntent = () => {
        if (scrollIntentRef) {
          scrollIntentRef.current = threadId ? 'smooth' : 'instant';
        }
      };

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

      // Synchronously derive video-link attachments + markdown + pasted-
      // token strip list from the click-time snapshot owned by
      // chat-interface.tsx (sourced from `useChatVideoLinks`'s reactive
      // jobs list). This used to be an awaited `bindCompletedJobsToMessage`
      // round-trip that gated `setPendingMessage`; that 50-200 ms gap is
      // what the user reported as "the composer doesn't clear quickly"
      // and "the bubble first shows a plain link then switches to the
      // styled card" — both symptoms collapse once optimistic builds
      // sync-from-local and the bubble lands in the same React commit as
      // `clearInputValue` (chat-interface.tsx:718). The bind mutation
      // still runs (see below, after setPendingMessage) to stamp
      // `messageBoundAt` server-side — it just no longer blocks UI.
      // `boundJobIdsLocal` is pre-seeded with snapshot ids so the
      // catch path below can call `unbindJobsFromMessage` if a downstream
      // `chatWithAgent` throw rolls everything back (round-2 V10 / HIGH
      // #17).
      const pastedTokensToStrip: string[] = [];
      const snapshotMarkdown: string[] = [];
      const snapshotJobIds: Array<Id<'videoLinkJobs'>> = [];
      const boundJobIdsLocal: Array<Id<'videoLinkJobs'>> = [];
      if (videoLinkSnapshot && videoLinkSnapshot.length > 0) {
        for (const job of videoLinkSnapshot) {
          // Re-assert the bind predicate to defend against a stale
          // snapshot (a chip status flipping between the click-handler
          // read and this point). Server bind would also skip these
          // rows, so optimistic and persisted stay aligned.
          if (job.displayStatus !== 'completed') continue;
          if (job.messageBoundAt !== undefined) continue;
          if (job.lifecycleStatus === 'trashed') continue;
          if (!job.storageId) continue;
          // fileType sentinel matches the bind mutation's output —
          // `isAudioOrVideo` in start_agent_chat.ts picks the video icon
          // and the `🎬 [...]` template branch off this exact string.
          const fileType = 'video/mp4';
          const fileName = job.videoTitle ?? 'Video link';
          const fileSize = job.fileSize ?? 0;
          mutationAttachments.push({
            fileId: job.storageId,
            fileName,
            fileType,
            fileSize,
          });
          pastedTokensToStrip.push(job.pastedToken);
          snapshotJobIds.push(job.jobId);
          boundJobIdsLocal.push(job.jobId);
          snapshotMarkdown.push(
            formatVideoLinkAttachmentMarkdown({
              fileId: job.storageId,
              fileName,
              fileType,
              fileSize,
              videoTitle: job.videoTitle,
              videoUploader: job.videoUploader,
              sourcePlatform: job.sourcePlatform,
              videoDurationSec: job.videoDurationSec,
            }),
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
          // Send the URL-stripped variant. The raw pasted video URL can
          // carry `?si=…` / `?utm_*` tokens that PII heuristics flag as
          // credentials; precheck on the about-to-be-sent message text
          // matches what the agent will actually receive.
          { organizationId, text: messageToSend },
        );
        if (precheck.blocked) {
          clearChatState();
          // Restore the chips the caller hid synchronously on click —
          // the block branch never reaches the bg-bind path, so without
          // this the chips stay invisible (they were filtered out of
          // `useChatVideoLinks` by the client-side hide set, not by
          // `messageBoundAt`) and the user loses both their typed text
          // and every transcript attachment on a guardrails block.
          if (unmarkJobsSent && snapshotJobIds.length > 0) {
            unmarkJobsSent(snapshotJobIds);
          }
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
      // Append the same per-attachment markdown that the server's
      // `buildMessageWithAttachments` (start_agent_chat.ts) emits, using
      // the shared formatter. Without parity here the optimistic body and
      // the persisted body differ by ~2 lines of literal text (user
      // bubbles render `whitespace-pre-wrap` so the brackets/asterisks
      // ARE shown, not formatted) and the user sees the bubble grow on
      // the optimistic→persisted swap.
      const optimisticContent =
        snapshotMarkdown.length > 0
          ? messageToSend
            ? `${messageToSend}\n\n${snapshotMarkdown.join('\n\n')}`
            : snapshotMarkdown.join('\n\n')
          : messageToSend;
      // Mark scroll-to-bottom intent IMMEDIATELY before the bubble mounts
      // — see `markScrollIntent` declaration above for the race-window
      // reasoning. Covers all three branches below uniformly.
      markScrollIntent();
      if (isArena) {
        if (currentArena.arenaThreadIdA && currentArena.arenaThreadIdB) {
          setPendingMessage({
            content: optimisticContent,
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
            content: optimisticContent,
            threadId: currentArena.arenaThreadIdA ?? 'pending',
            attachments: mutationAttachments,
            timestamp: pendingTimestamp,
            lastMessageKey,
          });
        }
      } else {
        setPendingMessage({
          content: optimisticContent,
          threadId: threadId ?? 'pending',
          attachments: mutationAttachments,
          timestamp: pendingTimestamp,
          lastMessageKey,
        });
      }

      // Background bind. With `setPendingMessage` already rendered above,
      // the bind no longer gates UI; it just stamps `messageBoundAt`
      // server-side so the chip migrates from the composer query to its
      // "bound to a sent message" state authoritatively. The single
      // transactional write is still the source of truth for the
      // chip-vs-drain race the round-2 review (B8/R2) flagged. If bind
      // returns rows the click-time snapshot missed (a chip that
      // completed during the click→precheck window), patch them onto the
      // pending message with a second `setPendingMessage` call so the
      // user-visible state stays correct without waiting for the
      // persisted server swap.
      if (threadId && videoLinkSnapshot && videoLinkSnapshot.length > 0) {
        try {
          const bound = await convexClient.mutation(
            api.video_links.mutations.bindCompletedJobsToMessage,
            { organizationId, threadId },
          );
          // Reconcile drift between snapshot and bind. The expected case
          // is `bound` ⊇ `snapshotJobIds` (snapshot was an instant in
          // time; nothing should disappear) but `bound` may carry an
          // extra job if a chip completed mid-click. Add those.
          const snapshotIdSet = new Set(snapshotJobIds);
          let driftDetected = false;
          for (const att of bound) {
            if (snapshotIdSet.has(att.jobId)) continue;
            driftDetected = true;
            mutationAttachments.push({
              fileId: att.fileId,
              fileName: att.fileName,
              fileType: att.fileType,
              fileSize: att.fileSize,
            });
            if (att.pastedToken && messageToSend.includes(att.pastedToken)) {
              messageToSend = messageToSend.replace(att.pastedToken, '');
            }
            boundJobIdsLocal.push(att.jobId);
          }
          if (driftDetected) {
            messageToSend = messageToSend.replace(/\s+/g, ' ').trim();
            // No shared `videoTitle`/`sourcePlatform` payload from bind
            // for the late arrivals, so the optimistic markdown for
            // these is a plain attachment footer — close enough to the
            // server output that the bubble height delta on persisted
            // swap is one line at most. Accepted compromise per the
            // approved plan; the snapshot-hit path (~99% of sends)
            // stays byte-identical.
            const driftMarkdown = bound
              .filter((att) => !snapshotIdSet.has(att.jobId))
              .map(
                (att) =>
                  `🎬 [${att.fileName}] (video)\n*(fileId: ${att.fileId} | fileName: ${att.fileName} | fileType: ${att.fileType} | fileSize: ${att.fileSize})*`,
              );
            const reconciledMarkdown = [...snapshotMarkdown, ...driftMarkdown];
            const reconciledContent = messageToSend
              ? `${messageToSend}\n\n${reconciledMarkdown.join('\n\n')}`
              : reconciledMarkdown.join('\n\n');
            markScrollIntent();
            if (isArena) {
              if (currentArena?.arenaThreadIdA && currentArena.arenaThreadIdB) {
                setPendingMessage({
                  content: reconciledContent,
                  threadId: currentArena.arenaThreadIdA,
                  arenaThreadIdB: currentArena.arenaThreadIdB,
                  attachments: mutationAttachments,
                  timestamp: pendingTimestamp,
                  lastMessageKey,
                });
              }
            } else {
              setPendingMessage({
                content: reconciledContent,
                threadId,
                attachments: mutationAttachments,
                timestamp: pendingTimestamp,
                lastMessageKey,
              });
            }
          }
        } catch (err) {
          console.error(
            '[use-send-message] background video-link bind failed:',
            err instanceof Error ? err.message : err,
          );
          // Restore the chips that were hidden synchronously on click —
          // without this the user sees their text + attachments vanish
          // and has no way to retry without re-pasting (round-2 V10 /
          // HIGH #17 spirit, adapted for the new sync-hide path).
          if (unmarkJobsSent && snapshotJobIds.length > 0) {
            unmarkJobsSent(snapshotJobIds);
          }
          const description =
            err instanceof Error && err.message
              ? err.message
              : t('videoLink.toast.bindFailedDescription');
          toast({
            title: t('toast.sendFailed'),
            description,
            variant: 'destructive',
          });
        }
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
            // Re-mark intent: an `await createThread` round-trip just
            // landed before this setPendingMessage, and observer fires
            // during that window may have downgraded/cleared the ref
            // set earlier above.
            markScrollIntent();
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
              boundJobIdsLocal.push(att.jobId);
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
            // Pre-create-thread optimistic update — same scroll-intent
            // refresh as the other call sites; cheap (a ref write).
            markScrollIntent();
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
            // Re-mark intent after `await createThread` round-trip
            // before swapping in the real threadId.
            markScrollIntent();
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
              boundJobIdsLocal.push(att.jobId);
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
        // Reverse any video-link binds we stamped before the throw. Without
        // this, the chip query (use-chat-video-links.ts) filters out
        // `messageBoundAt !== undefined` rows so the chips vanish from the
        // composer and the user has no way to recover the transcript
        // attachment without re-pasting + re-ingesting.
        if (boundJobIdsLocal.length > 0) {
          try {
            await convexClient.mutation(
              api.video_links.mutations.unbindJobsFromMessage,
              { jobIds: boundJobIdsLocal },
            );
          } catch (unbindErr) {
            console.warn(
              '[use-send-message] unbind-after-send-failure failed:',
              unbindErr instanceof Error ? unbindErr.message : unbindErr,
            );
          }
        }
        // Restore the chips the caller hid synchronously on click. The
        // server `unbindJobsFromMessage` above reverses `messageBoundAt`,
        // but the chips are *also* hidden by the client-side hide-set on
        // the composer hook — that's why a separate client rollback is
        // needed. Both paths are idempotent (set ops on `Set` / patch on
        // a row that's already unbound).
        if (unmarkJobsSent && boundJobIdsLocal.length > 0) {
          unmarkJobsSent(boundJobIdsLocal);
        }
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
      scrollIntentRef,
      unmarkJobsSent,
    ],
  );

  return { sendMessage };
}
