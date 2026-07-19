import { useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import {
  useCallback,
  useRef,
  startTransition,
  type MutableRefObject,
} from 'react';

import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { useConvexClient } from '@/app/hooks/use-convex-client';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { AUTO_AGENT_SLUG } from '@/lib/shared/constants/agents';
import { toastUnresolvedMentions } from '@/lib/shared/mention-unresolved';

import type {
  PendingMessage,
  SelectedAgent,
} from '../context/chat-layout-context';
import type { FileAttachment } from '../types';
import {
  useArenaChat,
  useCreateThread,
  useUnifiedChatWithAgent,
  useUpdateThread,
} from './mutations';
import type { VideoLinkJob } from './use-chat-video-links';
import type { KbMention } from './use-kb-mentions';
import type { ChatMessage } from './use-message-processing';
import { clearSendPending, markSendPending } from './use-pending-send';
import { resetGlobalFreeze } from './use-stream-buffer';
import type { UserContext } from './use-user-context';

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

type ProjectErrorCode =
  | 'PROJECT_MISMATCH'
  | 'PROJECT_FORBIDDEN'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_ORG_MISMATCH';

/**
 * Project-context send failures thrown synchronously by `chatWithAgentTurn`
 * (access denials + thread↔project mismatch). Mapped to their localized
 * `errors.*` messages so the user sees a meaningful toast instead of the raw
 * ConvexError payload.
 */
function extractProjectErrorCode(error: unknown): ProjectErrorCode | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  if (typeof data !== 'object' || data === null || !('code' in data)) {
    return null;
  }
  const code = data.code;
  if (
    code === 'PROJECT_MISMATCH' ||
    code === 'PROJECT_FORBIDDEN' ||
    code === 'PROJECT_NOT_FOUND' ||
    code === 'PROJECT_ORG_MISMATCH'
  ) {
    return code;
  }
  return null;
}

/**
 * `@`-mention KB reference rejected by `chatWithAgentTurn` (document deleted,
 * moved out of the user's teams, or no longer RAG-indexed between pick and
 * send). One opaque code server-side for every access failure; when the
 * document WAS accessible but simply isn't indexed, `resolveReferencedFiles`
 * additionally names the file + a `reason` (issue #2598) so the toast can say
 * something more useful than the generic opaque message — access failures
 * never carry these extra fields, so opacity for those is preserved.
 */
interface KbRefInvalidDetail {
  reason?: 'not_indexed' | 'unsupported';
  fileName?: string;
}

function extractKbRefInvalidDetail(error: unknown): KbRefInvalidDetail | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  if (typeof data !== 'object' || data === null || !('code' in data)) {
    return null;
  }
  if (data.code !== 'KB_REF_INVALID') return null;
  const reason =
    'reason' in data &&
    (data.reason === 'not_indexed' || data.reason === 'unsupported')
      ? data.reason
      : undefined;
  const fileName =
    'fileName' in data && typeof data.fileName === 'string'
      ? data.fileName
      : undefined;
  return { reason, fileName };
}

/**
 * `chatWithAgentTurn` throws `BACKEND_DRAINING` while a `tale deploy` is
 * draining the convex backend before recreating it (the new-turn gate). It's
 * transient — the backend accepts turns again within seconds once the restart
 * settles — so the send auto-retries rather than surfacing an error.
 */
function isBackendDrainingError(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    data.code === 'BACKEND_DRAINING'
  );
}

const DRAIN_RETRY_MAX = 8;
const DRAIN_RETRY_DELAY_MS = 2_000;

/**
 * Retry `fn` while it throws `BACKEND_DRAINING` (a deploy drain window),
 * bounded so a long drain doesn't hang the composer indefinitely — on exhaust
 * the error propagates to the normal send-failure handling (friendly toast).
 */
async function withBackendDrainRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < DRAIN_RETRY_MAX && isBackendDrainingError(error)) {
        await new Promise((resolve) =>
          setTimeout(resolve, DRAIN_RETRY_DELAY_MS),
        );
        continue;
      }
      throw error;
    }
  }
}

/** Derive a thread title from the first message, truncating long input. */
function buildThreadTitle(message: string): string {
  return message.length > 50 ? message.slice(0, 50) + '...' : message;
}

export interface SendMessageOptions {
  /**
   * Composer saw media still processing at click time (RAG-indexing files,
   * running transcriptions, in-flight video jobs). The send parks as a
   * `waiting_media` queue row (convex/threads/media_send.ts) instead of
   * dispatching; the readiness watcher starts the turn server-side.
   */
  deferForMedia?: boolean;
}

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
   * Whether the org has any enabled input guardrail (chat-filter / PII /
   * moderation). When explicitly `false`, the per-send `precheckInput` action
   * round-trip is skipped so the optimistic bubble renders and `chatWithAgent`
   * dispatches immediately (the common no-guardrails case). The server always
   * re-sanitizes authoritatively, so skipping the client precheck only drops the
   * pre-send block toast / optimistic mask — never a real block or mask.
   * Defaults to running precheck when `undefined` (flags still loading).
   */
  inputGuardrailsActive?: boolean;
  /**
   * Projects feature: when the chat originated from a project page
   * (via `/dashboard/$id/chat?projectId=...` or by opening a thread
   * already tagged with a projectId), the hook forwards it to
   * `chatWithAgent`. Server validates access + persists on
   * threadMetadata. Throws `PROJECT_MISMATCH` if a different project
   * is already pinned to the thread.
   */
  projectId?: string;
  /**
   * Auto-scroll force-snap ref owned by chat-interface.tsx (see
   * ChatScroll.scrollIntentRef). The hook sets it IMMEDIATELY before each
   * `setPendingMessage(...)` so the snap intent is fresh when the
   * MutationObserver picks up the new bubble.
   *
   * Why this is per-`setPendingMessage` rather than once at entry:
   * `bindCompletedJobsToMessage` for video-link attachments awaits a
   * 50-200 ms server round-trip BEFORE the optimistic message lands. If the
   * caller sets the intent before that await, a user scroll-up during the
   * wait clears the ref (the scroll machine drops a pending snap the moment
   * the user escapes the pin). By the time the optimistic bubble mounts the
   * intent would be gone and the view wouldn't snap to the new message —
   * visible as "scroll didn't follow after sending a video link" while plain
   * text / images work (those paths skip the bind round-trip). Re-marking
   * adjacent to every `setPendingMessage` keeps the snap armed.
   */
  scrollIntentRef?: MutableRefObject<boolean | 'smooth'>;
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
  /**
   * Restore the composer's `@`-mention KB reference chips on send-failure
   * paths (precheck block, chatWithAgent throw). The chips were cleared
   * synchronously in ChatInput's send handler; without this rollback a
   * failed send silently drops every pinned document. Mirrors
   * `unmarkJobsSent` for video-link chips.
   */
  restoreKbMentions?: (mentions: KbMention[]) => void;
  /**
   * Working directory staged from the Sandbox pill BEFORE the thread exists
   * (the caller gates it to external-agent sends). Applied to the freshly
   * created thread's metadata right after `createThread` — ahead of the first
   * turn, which reads it at sandbox session start — then cleared via
   * `clearPendingSandboxWorkdir`. Best-effort: a failed apply falls back to
   * the workspace root rather than failing the send.
   */
  pendingSandboxWorkdir?: string;
  clearPendingSandboxWorkdir?: () => void;
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
  inputGuardrailsActive,
  projectId,
  scrollIntentRef,
  unmarkJobsSent,
  restoreKbMentions,
  pendingSandboxWorkdir,
  clearPendingSandboxWorkdir,
}: UseSendMessageParams) {
  const { t } = useT('chat');
  const { t: tCommon } = useT('common');
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
  // Ref so the reactive guardrails flag doesn't destabilize the sendMessage
  // callback (matches the arena-param pattern above).
  const inputGuardrailsActiveRef = useRef(inputGuardrailsActive);
  inputGuardrailsActiveRef.current = inputGuardrailsActive;
  // Same ref pattern for the staged pre-thread workdir: it changes whenever
  // the user edits the Sandbox pill, and must not churn sendMessage.
  const pendingSandboxWorkdirRef = useRef(pendingSandboxWorkdir);
  pendingSandboxWorkdirRef.current = pendingSandboxWorkdir;
  const clearPendingSandboxWorkdirRef = useRef(clearPendingSandboxWorkdir);
  clearPendingSandboxWorkdirRef.current = clearPendingSandboxWorkdir;

  // Simple ref guard to prevent double-send during the async gap
  const sendingRef = useRef(false);

  const sendMessage = useCallback(
    async (
      message: string,
      attachments?: FileAttachment[],
      videoLinkSnapshot?: VideoLinkJob[],
      kbReferences?: KbMention[],
      options?: SendMessageOptions,
    ) => {
      if (sendingRef.current) return;

      // "Auto" mode is represented by a null selection (the persisted default
      // for new users). In Auto we send the AUTO_AGENT_SLUG sentinel and the
      // server routes to a concrete agent. A pinned agent sends its own slug.
      // Arena mode is the exception — it compares two models on one chosen
      // agent, so it still requires an explicit selection (enforced below).
      const agentSlugToSend = selectedAgent?.name ?? AUTO_AGENT_SLUG;

      // Explicit projection so only the agent-template fields ride along,
      // independent of any future widening of `UserContext`.
      const userContextPayload = userContext
        ? {
            timezone: userContext.timezone,
            language: userContext.language,
            uiLanguage: userContext.uiLanguage,
          }
        : undefined;

      sendingRef.current = true;

      // Set the auto-scroll-to-bottom intent IMMEDIATELY before any
      // setPendingMessage call. See `UseSendMessageParams.scrollIntentRef`
      // docstring — setting it once at the outer `handleSendMessage`
      // entry (before this hook's awaits) lets a user scroll-up during a
      // long await clear the pending snap (the scroll machine drops it the
      // moment the user escapes the pin, e.g. during the video-link
      // `bindCompletedJobsToMessage` round-trip), so by the time the
      // optimistic bubble lands, the snap wouldn't fire.
      // The FIRST message of a chat snaps INSTANTLY — the conversation is
      // empty, so the message must simply render at its position with no
      // visible scrolling. Follow-up messages glide smoothly to the new
      // user message via the retargeting rAF snap (see
      // ChatScroll.scrollIntentRef).
      const isEmptyChat = !threadId || (messages?.length ?? 0) === 0;
      const markScrollIntent = () => {
        if (scrollIntentRef) {
          scrollIntentRef.current = isEmptyChat ? true : 'smooth';
        }
      };

      // Convert attachments format (synchronous — needed for optimistic message)
      const mutationAttachments: Array<{
        /** Blob reference: a Convex `_storage` id or an `s3:` ref. */
        fileId: string;
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

      // `@`-mention KB references ride the optimistic bubble as DISPLAY
      // attachments only (matching the chips the persisted swap extracts from
      // the server's enriched marker block) — they are NOT part of the
      // mutation `attachments` arg, which would re-register the blobs with
      // the agent and duplicate the existing RAG index. The server receives
      // `referencedDocumentIds` / `referencedFolderIds` instead and resolves
      // them authoritatively. Folder pins have no storage blob, so they skip
      // the optimistic display list — their chip appears with the persisted
      // swap (parsed from the folder marker block).
      const kbDocumentRefs =
        kbReferences?.filter((ref) => ref.kind === 'document') ?? [];
      const kbFolderRefs =
        kbReferences?.filter((ref) => ref.kind === 'folder') ?? [];
      const kbDisplayAttachments = kbDocumentRefs.map((ref) => ({
        fileId: ref.fileId,
        fileName: ref.title,
        fileType: ref.fileType,
        fileSize: ref.fileSize,
      }));
      const buildDisplayAttachments = () =>
        kbDisplayAttachments.length > 0
          ? [...mutationAttachments, ...kbDisplayAttachments]
          : mutationAttachments;
      const referencedDocumentIds =
        kbDocumentRefs.length > 0
          ? kbDocumentRefs.map((ref) => ref.documentId)
          : undefined;
      const referencedFolderIds =
        kbFolderRefs.length > 0
          ? kbFolderRefs.map((ref) => ref.folderId)
          : undefined;
      const rollbackKbMentions = () => {
        if (restoreKbMentions && kbReferences && kbReferences.length > 0) {
          restoreKbMentions(kbReferences);
        }
      };

      // Synchronously derive video-link attachments + pasted-token strip
      // list from the click-time snapshot owned by chat-interface.tsx
      // (sourced from `useChatVideoLinks`'s reactive jobs list). This used
      // to be an awaited `bindCompletedJobsToMessage` round-trip that
      // gated `setPendingMessage`; that 50-200 ms gap is what the user
      // reported as "the composer doesn't clear quickly" and "the bubble
      // first shows a plain link then switches to the styled card" — both
      // symptoms collapse once optimistic builds sync-from-local and the
      // bubble lands in the same React commit as `clearInputValue`
      // (chat-interface.tsx:718). The bind mutation still runs (see
      // below, after setPendingMessage) to stamp `messageBoundAt`
      // server-side — it just no longer blocks UI. `boundJobIdsLocal` is
      // pre-seeded with snapshot ids so the catch path below can call
      // `unbindJobsFromMessage` if a downstream `chatWithAgent` throw
      // rolls everything back (round-2 V10 / HIGH #17).
      const pastedTokensToStrip: string[] = [];
      const snapshotJobIds: Array<Id<'videoLinkJobs'>> = [];
      const boundJobIdsLocal: Array<Id<'videoLinkJobs'>> = [];

      const currentArena = arenaRef.current;
      const modelA = currentArena?.modelA;
      const modelB = currentArena?.modelB;
      const isArena = currentArena?.isArenaMode && modelA && modelB;

      // Send-then-wait: media was still processing at click time — the
      // composer flags pending files (options), and a not-yet-completed
      // video job in the snapshot flags itself. Such a send parks as a
      // `waiting_media` queue row (convex/threads/media_send.ts) instead of
      // dispatching; the readiness watcher starts the turn server-side.
      // Arena keeps the old completed-only behaviour (its send fans out to
      // two threads; deferral there is an explicit follow-up).
      const deferForMedia =
        !isArena &&
        (options?.deferForMedia === true ||
          (videoLinkSnapshot?.some(
            (j) =>
              j.messageBoundAt === undefined &&
              j.lifecycleStatus !== 'trashed' &&
              j.displayStatus !== 'completed' &&
              j.displayStatus !== 'failed' &&
              j.displayStatus !== 'skipped',
          ) ??
            false));

      if (videoLinkSnapshot && videoLinkSnapshot.length > 0) {
        for (const job of videoLinkSnapshot) {
          // Re-assert the bind predicate to defend against a stale
          // snapshot (a chip status flipping between the click-handler
          // read and this point). Server bind would also skip these
          // rows, so optimistic and persisted stay aligned.
          if (job.messageBoundAt !== undefined) continue;
          if (job.lifecycleStatus === 'trashed') continue;
          if (deferForMedia) {
            // Deferred path: the enqueue mutation claims the jobs and the
            // turn start builds their payloads — collect ids + strip every
            // pasted token now (completed AND in-flight), push no payloads
            // (the server would double them otherwise).
            if (job.displayStatus === 'skipped') continue;
            if (job.displayStatus === 'failed') continue;
            snapshotJobIds.push(job.jobId);
            pastedTokensToStrip.push(job.pastedToken);
            continue;
          }
          if (job.displayStatus !== 'completed') continue;
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
        }
      }

      // Arena compares two models on ONE chosen agent, so it can't run in
      // "Auto" mode — it needs an explicit selection. Fail fast before any
      // optimistic UI, and release the send lock taken above.
      if (isArena && !selectedAgent) {
        sendingRef.current = false;
        toast({
          title: t('toast.arenaRequiresAgent'),
          variant: 'destructive',
        });
        return;
      }

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
      // Skip the precheck action round-trip when the org has NO enabled input
      // guardrail (the common case) so the optimistic bubble renders and
      // chatWithAgent dispatches immediately. The server re-sanitizes
      // authoritatively on the real send regardless, so skipping here only drops
      // the pre-send block toast / optimistic mask — never a real block or mask.
      // When the flag is undefined (feature flags still loading) we run precheck
      // to stay safe.
      if (inputGuardrailsActiveRef.current !== false) {
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
            // Same rollback for `@`-mention KB reference chips.
            rollbackKbMentions();
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
      }

      // --- Send-then-wait (media still processing) -----------------------
      // Park the send as a waiting_media queue row and return: the thread
      // exists (created here for welcome-page sends), the composer clears,
      // and the QUEUE TRAY is the visible representation — no optimistic
      // bubble (the pipeline saves the real user message when the readiness
      // watcher starts the turn). KB references never reach this branch —
      // the composer blocks the @-mention + processing-media combination.
      if (deferForMedia) {
        try {
          let ensuredThreadId = threadId;
          if (!ensuredThreadId) {
            const title = buildThreadTitle(messageToSend);
            ensuredThreadId = await createThread({
              organizationId,
              title,
              chatType: 'general',
              teamId,
            });
            setPendingThreadId(ensuredThreadId);
            const navThreadId = ensuredThreadId;
            startTransition(() => {
              void navigate({
                to: '/dashboard/$id/chat/$threadId',
                params: { id: organizationId, threadId: navThreadId },
              });
            });
          }
          await convexClient.mutation(api.threads.media_send.enqueueMediaSend, {
            threadId: ensuredThreadId,
            organizationId,
            message: messageToSend,
            agentSlug: agentSlugToSend,
            modelId: modelId || undefined,
            ...(mutationAttachments.length > 0 && {
              attachments: mutationAttachments,
            }),
            ...(snapshotJobIds.length > 0 && { videoJobIds: snapshotJobIds }),
          });
        } catch (err) {
          // Same rollback contract as a failed dispatch: chips + KB pins
          // return, the caller (chat-interface) restores the typed draft.
          if (unmarkJobsSent && snapshotJobIds.length > 0) {
            unmarkJobsSent(snapshotJobIds);
          }
          rollbackKbMentions();
          toast({ title: t('toast.sendFailed'), variant: 'destructive' });
          sendingRef.current = false;
          throw err instanceof Error ? err : new Error(String(err));
        }
        sendingRef.current = false;
        return;
      }

      // Show optimistic message AFTER precheck so it reflects any mask
      // rewrite from the server. For orgs without guardrails this is a
      // single cheap query (<50ms typically) — the previous "instant"
      // render was only winning a round-trip anyway.
      const lastMessageKey = messages[messages.length - 1]?.key;
      const pendingTimestamp = new Date();
      // Video-link metadata rides on `attachments[]` (rendered by the
      // bubble's `file-displays`), not in `content`. The server still
      // builds the verbose `🎬 [...]` markdown via
      // `buildMessageWithAttachments`, but the persisted body is stripped
      // back out on read (`stripInternalFileReferences` in
      // use-message-processing.ts) before the bubble sees it — so
      // appending it here would just make the optimistic bubble flicker
      // larger-then-smaller on the persisted swap.
      const optimisticContent = messageToSend;
      // Mark scroll-to-bottom intent IMMEDIATELY before the bubble mounts
      // — see `markScrollIntent` declaration above for the race-window
      // reasoning. Covers all three branches below uniformly.
      markScrollIntent();
      if (isArena) {
        const arenaThreadIdA = currentArena.arenaThreadIdA;
        const arenaThreadIdB = currentArena.arenaThreadIdB;
        if (arenaThreadIdA && arenaThreadIdB) {
          setPendingMessage({
            content: optimisticContent,
            threadId: arenaThreadIdA,
            arenaThreadIdB: arenaThreadIdB,
            attachments: buildDisplayAttachments(),
            timestamp: pendingTimestamp,
            lastMessageKey,
          });
          queueMicrotask(() => {
            markSendPending(arenaThreadIdA);
            markSendPending(arenaThreadIdB);
          });
        } else {
          // Thread A may exist (arenaThreadIdA set) but B needs creation,
          // or neither exists yet (new chat). Use the known A ID so
          // ArenaColumn A can match and display the optimistic message.
          setPendingMessage({
            content: optimisticContent,
            threadId: arenaThreadIdA ?? 'pending',
            attachments: buildDisplayAttachments(),
            timestamp: pendingTimestamp,
            lastMessageKey,
          });
          if (arenaThreadIdA) {
            queueMicrotask(() => markSendPending(arenaThreadIdA));
          }
        }
      } else {
        setPendingMessage({
          content: optimisticContent,
          threadId: threadId ?? 'pending',
          attachments: buildDisplayAttachments(),
          timestamp: pendingTimestamp,
          lastMessageKey,
        });
        // Defer one microtask so the optimistic user (and shell) commit before
        // `isSendPending` — prevents one frame of thinking on the prior turn.
        if (threadId) queueMicrotask(() => markSendPending(threadId));
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
            // Late-arrival attachments get patched onto the pending
            // message via the `attachments[]` array; the bubble's
            // `file-displays` picks up the new card on the next commit.
            // `content` carries only the typed text (server-side markdown
            // is stripped before display), so it stays stable across the
            // drift patch and the eventual persisted swap.
            markScrollIntent();
            if (isArena) {
              if (currentArena?.arenaThreadIdA && currentArena.arenaThreadIdB) {
                setPendingMessage({
                  content: messageToSend,
                  threadId: currentArena.arenaThreadIdA,
                  arenaThreadIdB: currentArena.arenaThreadIdB,
                  attachments: buildDisplayAttachments(),
                  timestamp: pendingTimestamp,
                  lastMessageKey,
                });
              }
            } else {
              setPendingMessage({
                content: messageToSend,
                threadId,
                attachments: buildDisplayAttachments(),
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
          const title = buildThreadTitle(messageToSend);
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
            // landed before this setPendingMessage, and a user scroll-up
            // during that window may have cleared the snap set earlier above.
            markScrollIntent();
            setPendingMessage({
              content: messageToSend,
              threadId: tIdA,
              arenaThreadIdB: tIdB,
              attachments: buildDisplayAttachments(),
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
          //
          // Bind when this is a NEW-thread send (`!threadId`) OR there are
          // completed jobs in the click-time snapshot. The `!threadId` clause is
          // load-bearing: pre-thread jobs only exist when there was no thread at
          // click time, and a job still transcribing at click time is absent
          // from the (completed-only) snapshot — so gating purely on the
          // snapshot would drop a job that finishes during the createThread
          // round-trip. An existing-thread send with an empty snapshot (the
          // common plain-text case) still skips the zero-row round-trip.
          if (
            !threadId ||
            (videoLinkSnapshot && videoLinkSnapshot.length > 0)
          ) {
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
                if (
                  att.pastedToken &&
                  messageToSend.includes(att.pastedToken)
                ) {
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
          }

          // Flip per-thread optimistic spinner IMMEDIATELY so both columns
          // show "Thinking" before the Node action cold-starts. Real
          // isThreadGenerating subscriptions take over once they arrive.
          markPending(tIdA);
          markPending(tIdB);

          // Start both models generating (split view shows "Thinking").
          // Retry through a deploy drain window (transient BACKEND_DRAINING).
          await withBackendDrainRetry(() =>
            arenaChatRef.current({
              // Guarded above: arena requires a pinned agent, so this is never
              // the Auto sentinel here.
              agentSlug: agentSlugToSend,
              threadIdA: tIdA,
              threadIdB: tIdB,
              organizationId,
              message: messageToSend,
              modelIdA: modelA,
              modelIdB: modelB,
              attachments: mutationAttachments,
              userContext: userContextPayload,
              // History is copied when Thread B is created (arena enable),
              // not at send time — no need to copy again.
            }),
          );
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
              attachments: buildDisplayAttachments(),
              timestamp: pendingTimestamp,
              lastMessageKey,
            });

            const title = buildThreadTitle(messageToSend);
            const newThreadId = await createThread({
              organizationId,
              title,
              chatType: 'general',
              teamId,
            });
            currentThreadId = newThreadId;
            isFirstMessage = true;

            // Apply the workdir staged from the Sandbox pill before the
            // thread existed — must land BEFORE the turn dispatches below,
            // because runExternalAgentTurn reads it at session start. Best-
            // effort: on failure the turn falls back to the workspace root,
            // never the send failing over a workdir nicety.
            const stagedWorkdir = pendingSandboxWorkdirRef.current;
            if (stagedWorkdir) {
              try {
                await convexClient.mutation(
                  api.threads.mutations.setSandboxWorkdir,
                  { threadId: newThreadId, workdir: stagedWorkdir },
                );
              } catch (err) {
                console.error(
                  '[use-send-message] staged workdir apply failed:',
                  err instanceof Error ? err.message : err,
                );
              }
              clearPendingSandboxWorkdirRef.current?.();
            }

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
              attachments: buildDisplayAttachments(),
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
            const title = buildThreadTitle(messageToSend);
            // Fire-and-forget: the thread title is a cosmetic sidebar label and
            // generation does not depend on it, so awaiting it here would only
            // add a serial mutation round-trip before chatWithAgent dispatches.
            void updateThread({ threadId: currentThreadId, title }).catch(
              (err: unknown) =>
                console.warn(
                  '[use-send-message] first-message title update failed:',
                  err instanceof Error ? err.message : err,
                ),
            );
          }

          // Bind pre-thread video-link jobs to the just-created (or
          // already-existing) thread. The early bind at the top of this
          // callback gates on `if (threadId)` so it skips welcome-page
          // first-sends entirely — by here we have a real threadId either
          // way, which is the moment to pull pre-thread chips in. Without
          // this second bind, welcome-page video-link pastes lose their
          // attachment and the LLM only sees the raw URL.
          //
          // Bind when this is a NEW-thread send (`!threadId`) OR there are
          // completed jobs in the click-time snapshot. The `!threadId` clause is
          // load-bearing: this bind's whole purpose is to pull in PRE-thread jobs
          // (which only exist when there was no thread at click time), and a job
          // still transcribing at click time is absent from the completed-only
          // snapshot — so gating purely on snapshot length would drop a job that
          // finishes during the awaited createThread round-trip. An
          // existing-thread send with an empty snapshot (the overwhelming
          // plain-text majority) still skips this zero-row round-trip.
          if (
            !threadId ||
            (videoLinkSnapshot && videoLinkSnapshot.length > 0)
          ) {
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
                if (
                  att.pastedToken &&
                  messageToSend.includes(att.pastedToken)
                ) {
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
          }

          // Flip the optimistic spinner IMMEDIATELY — the Node action cold
          // start adds ~100–300 ms before markGenerating commits. Real
          // isThreadGenerating takes over once it arrives.
          markPending(currentThreadId);

          // Capture into a const so the narrowed `string` type survives inside
          // the retry closure (a `let` widens back to `string | undefined`).
          const threadIdForSend = currentThreadId;
          // Retry through a deploy drain window (transient BACKEND_DRAINING).
          const sendResult = await withBackendDrainRetry(() =>
            chatWithAgent({
              agentSlug: agentSlugToSend,
              threadId: threadIdForSend,
              organizationId,
              message: messageToSend,
              modelId: modelId || undefined,
              capabilityBindings:
                enabledCapabilities.length > 0
                  ? enabledCapabilities
                  : undefined,
              attachments: mutationAttachments,
              referencedDocumentIds,
              referencedFolderIds,
              userContext: userContextPayload,
              projectId: projectId ? asProjectId(projectId) : undefined,
            }),
          );
          toastUnresolvedMentions(
            sendResult.unresolvedMentionTokens,
            toast,
            tCommon,
          );
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
        // Restore the `@`-mention KB reference chips (cleared synchronously
        // in ChatInput's send handler) so the user can retry without
        // re-picking every document.
        rollbackKbMentions();
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
        const projectCode = extractProjectErrorCode(error);
        const kbRefDetail = extractKbRefInvalidDetail(error);

        let title = t('toast.sendFailed');
        let description = errorMessage;
        if (isBackendDrainingError(error)) {
          // Drain outlasted the retry budget — the backend is mid-restart
          // (deploy). Tell the user to resend in a moment rather than show a
          // raw error; their in-flight turn (if any) is recovered server-side.
          title = t('toast.backendRestarting');
          description = t('toast.backendRestartingDescription');
        } else if (
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
        } else if (kbRefDetail) {
          description =
            kbRefDetail.reason === 'unsupported' && kbRefDetail.fileName
              ? t('toast.kbRefUnsupported', { fileName: kbRefDetail.fileName })
              : kbRefDetail.reason === 'not_indexed' && kbRefDetail.fileName
                ? t('toast.kbRefNotIndexed', { fileName: kbRefDetail.fileName })
                : t('toast.kbRefInvalid');
        } else if (projectCode) {
          // Surface the localized project-context message instead of the raw
          // ConvexError payload (which would otherwise show as the description).
          description =
            projectCode === 'PROJECT_MISMATCH'
              ? t('errors.PROJECT_MISMATCH')
              : projectCode === 'PROJECT_FORBIDDEN'
                ? t('errors.PROJECT_FORBIDDEN')
                : projectCode === 'PROJECT_NOT_FOUND'
                  ? t('errors.PROJECT_NOT_FOUND')
                  : t('errors.PROJECT_ORG_MISMATCH');
        }

        toast({
          title,
          description,
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
      tCommon,
      convexClient,
      teamId,
      projectId,
      scrollIntentRef,
      unmarkJobsSent,
      restoreKbMentions,
    ],
  );

  return { sendMessage };
}
