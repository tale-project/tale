'use client';

import { Stack } from '@tale/ui/layout';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import {
  useRef,
  useEffect,
  useId,
  useState,
  useCallback,
  useMemo,
} from 'react';

import { PanelFooter } from '@/app/components/layout/panel-footer';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { PageDropOverlay } from '@/app/components/ui/page-drop-overlay';
import {
  useClockOffset,
  useReportServerNow,
} from '@/app/hooks/use-clock-offset';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { usePageFileDrop } from '@/app/hooks/use-page-file-drop';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useOptionalTeamFilter } from '@/app/hooks/use-team-filter';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { lazyComponent } from '@/lib/utils/lazy-component';

import { stripModelRefQualifier } from '../../../../lib/shared/utils/model-ref';
import { useDeletePrompt } from '../../prompts/hooks/mutations';
import { useSavedSourceMessageIds } from '../../prompts/hooks/queries';
import {
  useMyBudgetStatus,
  useMyFeatureFlags,
} from '../../settings/governance/hooks/queries';
import { useListProviders } from '../../settings/providers/hooks/queries';
import { useBranchContext } from '../context/branch-context';
import { useChatLayout } from '../context/chat-layout-context';
import {
  useEditAndBranch,
  useEnqueueMessage,
  useForkOwnThread,
  useMarkThreadRead,
  useUnarchiveThread,
} from '../hooks/mutations';
import {
  ThreadMessageMetadataProvider,
  useChatAgents,
  useResolvedHumanInputRequests,
  useSessionProgress,
  isAgentActivelyWorking,
  isAgentLingeringSteerReady,
} from '../hooks/queries';
import { useArenaThreadSetup } from '../hooks/use-arena-thread-setup';
import { useChatScroll } from '../hooks/use-chat-scroll';
import { useChatVideoLinks } from '../hooks/use-chat-video-links';
import { useConvexFileUpload } from '../hooks/use-convex-file-upload';
import { useEffectiveAgent } from '../hooks/use-effective-agent';
import { useFileIndexingStatus } from '../hooks/use-file-indexing-status';
import { useFileTranscriptionStatus } from '../hooks/use-file-transcription-status';
import { useKbMentions, type KbMention } from '../hooks/use-kb-mentions';
import { useMergedChatItems } from '../hooks/use-merged-chat-items';
import { useMessageProcessing } from '../hooks/use-message-processing';
import { useModelFallbackAutoSwitch } from '../hooks/use-model-fallback-auto-switch';
import { usePendingMessages } from '../hooks/use-pending-messages';
import {
  useIsSendPending,
  clearSendPending,
  markSendPending,
} from '../hooks/use-pending-send';
import { usePersistedAttachments } from '../hooks/use-persisted-attachments';
import { usePrewarmChatCache } from '../hooks/use-prewarm-chat-cache';
import { useSendMessage } from '../hooks/use-send-message';
import { useStopGenerating } from '../hooks/use-stop-generating';
import { useStreamingToolBridge } from '../hooks/use-streaming-tool-bridge';
import { useThreadAgentLock } from '../hooks/use-thread-agent-lock';
import { useThreadApprovals } from '../hooks/use-thread-approvals';
import { useThreadImages } from '../hooks/use-thread-images';
import { useUserContext } from '../hooks/use-user-context';
import type { FileAttachment } from '../types';
import { useArenaModeOptional } from './arena/arena-mode-context';
import { ArenaSplitView } from './arena/arena-split-view';
import { ChatInput } from './chat-input';
import { ArchivedBanner } from './chat-interface/archived-banner';
import { ReadOnlyBanner } from './chat-interface/read-only-banner';
import { ScrollToBottomButton } from './chat-interface/scroll-to-bottom-button';
import { ChatMessages } from './chat-messages';
import { ChatMessagesErrorBoundary } from './chat-messages-error-boundary';
import { ChatMessagesSkeleton } from './chat-messages-skeleton';
import { EditingBanner, imageRefToAttachment } from './editing-banner';
import { useEffectiveEditingImage } from './editing-banner';
import {
  QueuedMessageTray,
  type PendingTrayEntry,
} from './queued-message-tray';
import { SelectionQuoteButton } from './selection-quote-button';
import { SteerStatusProvider } from './steer-status';
import type { ThinkingAnchor } from './thought-timeline/use-thinking-timer';
import { WelcomeView } from './welcome-view';

const SavePromptDialog = lazyComponent<
  import('@/app/features/prompts/components/save-prompt-dialog').SavePromptDialogProps
>(() =>
  import('@/app/features/prompts/components/save-prompt-dialog').then(
    (mod) => ({ default: mod.SavePromptDialog }),
  ),
);

const PromptLibraryDialog = lazyComponent<
  import('@/app/features/prompts/components/prompt-library-dialog').PromptLibraryDialogProps
>(() =>
  import('@/app/features/prompts/components/prompt-library-dialog').then(
    (mod) => ({ default: mod.PromptLibraryDialog }),
  ),
);

function chatDraftKey(
  userId: string | undefined,
  organizationId: string,
  threadId?: string,
) {
  const prefix = userId
    ? `chat-draft-${userId}-${organizationId}`
    : `chat-draft-${organizationId}`;
  return threadId ? `${prefix}-${threadId}` : `${prefix}-new`;
}

interface ChatInterfaceProps {
  organizationId: string;
  threadId?: string;
  readOnly?: boolean;
  /** Resolved thread status from `ThreadGate`'s `getThreadStatus` subscription,
   *  passed down so we don't open a second identical subscription here just to
   *  derive `isArchived`. `undefined` while loading / for new/just-created
   *  threads (treated as not-archived). */
  threadStatus?: string | null;
  /**
   * True only while `ThreadGate` is holding a neutral footer for a thread it
   * hasn't classified yet AND can't seed an "archived" guess from the
   * already-loaded archived-threads list either (this session's very first
   * thread open — see `ThreadGate`). Guessing "not archived" in that narrow
   * window is exactly the composer→archived-banner flash #2658 removes, so
   * the footer renders neither state while this is true.
   */
  threadStatusPending?: boolean;
}

export function ChatInterface({
  organizationId,
  threadId,
  readOnly = false,
  threadStatus,
  threadStatusPending = false,
}: ChatInterfaceProps) {
  const { t } = useT('chat');
  const chatRegionLabelId = useId();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const {
    setPendingThreadId,
    clearChatState,
    pendingMessage,
    setPendingMessage,
    selectedModelOverrides,
    setSelectedModelOverride,
    enabledCapabilities,
    insertedPrompt,
    setInsertedPrompt,
    selectedAgent: globalSelectedAgent,
    pendingSandboxWorkdir,
    setPendingSandboxWorkdir,
  } = useChatLayout();

  const arenaContext = useArenaModeOptional();
  const isArenaMode = arenaContext?.isArenaMode ?? false;

  // Arena thread-pair lifecycle (create Thread B, exit-on-new-chat). See hook.
  useArenaThreadSetup({ organizationId, threadId });

  const { activeBranchThreadId } = useBranchContext();
  // Use the active branch thread for data loading, but keep URL threadId for drafts/routing
  const dataThreadId = activeBranchThreadId ?? threadId;

  // External-agent threads are agent-locked: the thread's bound agent wins
  // over the global per-user selection (which a switch in ANOTHER thread may
  // have moved) for everything downstream — send, queue-mode enqueue, and the
  // optimistic thinking shell. The backend enforces the same lock
  // (chat_turn_generate step 0); this keeps the UI honest about it.
  const { lockedAgent } = useThreadAgentLock(organizationId, dataThreadId);
  const selectedAgent = useMemo(
    () =>
      lockedAgent
        ? { name: lockedAgent.name, displayName: lockedAgent.displayName }
        : globalSelectedAgent,
    [lockedAgent, globalSelectedAgent],
  );
  // `isAgentLoading` is the chat agent catalog (action-backed, warmed in the
  // /dashboard/$id loader). Deliberately NOT used to gate first paint: the
  // WelcomeView and composer (incl. the AgentSelector trigger) render
  // immediately and mask only their dynamic leaves while the catalog loads, so
  // the composer is interactive sooner. Do not turn this into a whole-tree
  // gate — it would re-block first paint on the catalog round-trip. It is only
  // forwarded to WelcomeView for granular masking below.
  const { agent: effectiveAgent, isLoading: isAgentLoading } =
    useEffectiveAgent(organizationId);

  // Model overrides are keyed by agent name; on a locked thread the lookup
  // must follow the locked agent, not the global selection resolved into
  // `effectiveAgent`.
  const modelOverrideKey = lockedAgent?.name ?? effectiveAgent?.name;

  // `selectedAgent == null` means the composer is in Auto mode (the raw
  // selection, not the resolved `effectiveAgent`) — the turn will be Auto-routed,
  // so the optimistic thinking shell opens in the 'routing' phase.
  const isAutoRoute = selectedAgent == null;

  const [inputValue, setInputValue, clearInputValue] = usePersistedState(
    chatDraftKey(user?.userId, organizationId, threadId),
    '',
  );
  const [savePromptData, setSavePromptData] = useState<{
    messageId: string;
    content: string;
  } | null>(null);
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);

  const deletePrompt = useDeletePrompt();

  // Consume prompt content inserted from sidebar
  useEffect(() => {
    if (insertedPrompt) {
      setInputValue(insertedPrompt);
      setInsertedPrompt(null);
    }
  }, [insertedPrompt, setInsertedPrompt, setInputValue]);

  // Agent availability — disable input when no agents exist
  const { agents } = useChatAgents(organizationId);
  const hasNoAgents = agents !== undefined && agents.length === 0;

  // Image-generation agent derivations for EditingBanner. The thread's locked
  // agent wins over the global selection (see useThreadAgentLock above) so an
  // external-agent thread keeps queue mode even when another thread's switch
  // moved the global picker.
  const activeAgentMeta = useMemo(
    () => lockedAgent ?? agents?.find((a) => a.name === effectiveAgent?.name),
    [lockedAgent, agents, effectiveAgent?.name],
  );
  const isImageGenAgent =
    activeAgentMeta?.primaryBehavior === 'image-generation';
  // External-agent (sandbox session) threads support queue mode: the composer
  // stays usable while a turn runs and sends enqueue for the running agent.
  const isExternalAgentThread =
    activeAgentMeta?.primaryBehavior === 'external-agent';

  const {
    attachments,
    setAttachments,
    uploadingFiles,
    uploadFiles,
    cancelUpload,
    removeAttachment,
    retryAttachmentTranscription,
    clearAttachments,
  } = useConvexFileUpload({
    organizationId,
    threadId,
    // External agents read attachments straight from the sandbox, not the
    // KB — skip RAG indexing so those uploads don't show "Index failed".
    disableIndexing: isExternalAgentThread,
  });

  const { isIndexing, statusMap: indexingStatuses } = useFileIndexingStatus(
    attachments,
    organizationId,
  );

  const {
    isTranscribing,
    isQueryLoading: isTranscriptionQueryLoading,
    statusMap: transcriptionStatuses,
    hasFailedAudioJobs,
  } = useFileTranscriptionStatus(attachments, organizationId);

  const {
    jobs: videoLinkJobs,
    isAnyProcessing: isProcessingVideo,
    hasFailedJobs: hasFailedVideoJobs,
    ingestUrlsFromText: ingestVideoUrlsFromText,
    cancelJob: cancelVideoJob,
    retryJob: retryVideoJob,
    markJobsSent: markVideoJobsSent,
    unmarkJobsSent: unmarkVideoJobsSent,
  } = useChatVideoLinks({ threadId, organizationId });

  // `@`-mention knowledge-base references. Owned here (not inside ChatInput)
  // so a failed send can restore the chips — mirrors the attachments hook.
  const {
    mentions: kbMentions,
    addMention: addKbMention,
    removeMention: removeKbMention,
    clearMentions: clearKbMentions,
    restoreMentions: restoreKbMentions,
  } = useKbMentions();

  const { data: featureFlags } = useMyFeatureFlags(organizationId);
  const fileUploadDisabled = featureFlags?.fileUpload === false;

  usePersistedAttachments({
    userId: user?.userId,
    threadId,
    attachments,
    setAttachments,
  });

  // Message processing
  const {
    messages: rawMessages,
    loadMore,
    canLoadMore,
    isLoadingMore,
    activeMessage,
  } = useMessageProcessing(dataThreadId);

  const sessionProgress = useSessionProgress(dataThreadId);
  const isSendPending = useIsSendPending(dataThreadId);

  // Thread metadata (generation status + turn-start anchor). Pulled above
  // usePendingMessages so the shell survives clearSendPending on fast threads.
  const { data: threadMeta } = useConvexQuery(
    api.threads.queries.getThreadMeta,
    dataThreadId && organizationId
      ? { threadId: dataThreadId, organizationId }
      : 'skip',
  );
  // Feed the server clock into the offset authority from the subscription we
  // already hold (no extra query). Every downstream timer/relative-time then
  // runs in one clock frame instead of mixing a client wall clock with server
  // epochs. `toClientEpoch` is used below to convert the server turn-start
  // anchor for the reload/history fallback.
  useReportServerNow(threadMeta?.serverNow);
  const { toClientEpoch } = useClockOffset();
  const isGenerating = threadMeta?.isGenerating;
  const agentActivelyWorking = isAgentActivelyWorking(
    isGenerating,
    sessionProgress,
  );
  const agentLingeringSteerReady = isAgentLingeringSteerReady(sessionProgress);

  // Bridge the active message's live `file_write` tool calls into the
  // StreamingToolContext for the canvas pane. See hook.
  useStreamingToolBridge(activeMessage);

  // Merge with pending messages from context for optimistic UI.
  // In arena mode, ArenaColumns handle their own pending messages —
  // use rawMessages to keep a stable reference and avoid triggering
  // useMergedChatItems recalculation for components that won't render.
  const pendingMergedMessages = usePendingMessages({
    threadId: dataThreadId,
    realMessages: rawMessages,
    isSendPending,
    isAgentActivelyWorking: agentActivelyWorking,
    liveAssistantMessageId:
      sessionProgress?.status === 'running'
        ? (sessionProgress.assistantMessageId ?? null)
        : null,
    suppressOptimisticShell: !!pendingMessage?.editedMessageId,
  });
  const messages = isArenaMode ? rawMessages : pendingMergedMessages;

  // Build a lookup of messageId → promptId for saved prompts. Scoped to the
  // currently-rendered message ids so the server query payload is O(visible
  // messages), not O(save-history). Defined after `messages` so we can derive
  // the id list.
  const visibleMessageIds = useMemo(
    () => messages.map((msg) => msg.id),
    [messages],
  );
  const { data: savedPairs } = useSavedSourceMessageIds(
    organizationId,
    visibleMessageIds,
  );

  const savedMessageMap = useMemo(() => {
    const map = new Map<string, Id<'promptTemplates'>>();
    for (const pair of savedPairs ?? []) {
      map.set(pair.sourceMessageId, pair.promptId);
    }
    return map;
  }, [savedPairs]);

  const handleUnsavePrompt = useCallback(
    async (messageId: string) => {
      const promptId = savedMessageMap.get(messageId);
      if (!promptId) return;
      await deletePrompt.mutateAsync({ promptId });
    },
    [savedMessageMap, deletePrompt],
  );

  const threadImages = useThreadImages(isImageGenAgent ? messages : undefined);
  const { providers: providersForEdit } = useListProviders(organizationId);
  const activeModelRef = effectiveAgent?.name
    ? (selectedModelOverrides[effectiveAgent.name] ??
      activeAgentMeta?.supportedModels?.[0])
    : undefined;
  const activeModelInfo = useMemo(() => {
    if (!activeModelRef) return undefined;
    const plain = stripModelRefQualifier(activeModelRef);
    for (const p of providersForEdit) {
      if (!p || !('models' in p) || !Array.isArray(p.models)) continue;
      for (const model of p.models) {
        if (model.id === plain) return model;
      }
    }
    return undefined;
  }, [activeModelRef, providersForEdit]);
  const currentModelSupportsEdit = Boolean(
    activeModelInfo?.tags?.includes('image-edit'),
  );
  const currentModelLabel = activeModelInfo?.displayName;

  // Early "missing API key" gate: the provider that owns the selected model.
  const activeProvider = useMemo(() => {
    if (!activeModelRef) return undefined;
    const plain = stripModelRefQualifier(activeModelRef);
    return providersForEdit.find(
      (p) =>
        !!p &&
        'models' in p &&
        Array.isArray(p.models) &&
        p.models.some((mdl) => mdl.id === plain),
    );
  }, [activeModelRef, providersForEdit]);
  // Block only when we resolved the provider AND it definitively has no key
  // (and the model has no per-model override key) — never for unresolved refs,
  // so a valid send is never falsely blocked.
  const activeModelMissingApiKey =
    !!activeProvider &&
    'hasApiKey' in activeProvider &&
    !activeProvider.hasApiKey &&
    !activeModelInfo?.hasApiKeyOverride;
  // A brand-new org ships the model catalog with no credentials at all. In
  // that state even "Auto" cannot route anywhere — but no concrete provider
  // resolves, so activeModelMissingApiKey stays false and the composer used
  // to disable Send without ever stating a reason. Only blocks once the
  // provider list has loaded and none of them carries a key.
  const noProviderHasApiKey =
    providersForEdit.length > 0 &&
    providersForEdit.every(
      // Only a provider that definitively reports "no key" counts — a shape
      // without the field (redacted/partial) must never cause a false block.
      (p) => !!p && 'hasApiKey' in p && p.hasApiKey === false,
    ) &&
    !activeModelInfo?.hasApiKeyOverride;
  const { active: activeEditingImage } = useEffectiveEditingImage(threadImages);
  const { setEditingImageRef, setDismissedImageKey } = useChatLayout();

  // Send-block breakdown: the image-edit block takes priority in the reason
  // string, so exclude it from `missingKeyBlocked` to keep the two blocked
  // reasons in lockstep.
  //
  // #2576: missing API key is a setup blocker, not a draft-revision case —
  // unlike the other `sendBlocked` reasons below (budget, image-edit
  // mismatch) it now hard-blocks the composer itself (`disabled`/
  // `disabledReason="no-api-key"`), so the reason is visible on an empty
  // composer and Enter can't silently no-op (a `disabled` textarea can't
  // receive keyboard events at all). The actionable "Open provider settings"
  // deep link (or "ask an admin" hint) renders inline via `ProviderKeyErrorAction`
  // inside ChatInput's disabled-reason block, keyed off `organizationId` —
  // no separate action/description plumbing needed here.
  const imageEditBlocked =
    isImageGenAgent && !!activeEditingImage && !currentModelSupportsEdit;
  const missingKeyBlocked =
    !imageEditBlocked && (activeModelMissingApiKey || noProviderHasApiKey);

  // Thread status — disable input for archived threads. Status is derived from
  // the URL threadId (root thread), not dataThreadId (which may be a branch
  // thread that wasn't individually archived). Provided by ThreadGate to avoid
  // a duplicate getThreadStatus subscription on every thread switch.
  const isArchived = threadStatus === 'archived';

  const { mutate: unarchiveThread, isPending: isUnarchiving } =
    useUnarchiveThread();

  // Approvals — single org-wide subscription partitioned into typed buckets
  // in one pass (see use-thread-approvals.ts). Replaces seven hooks that each
  // re-filtered the same list.
  const {
    integrationApprovals,
    workflowCreationApprovals,
    workflowUpdateApprovals,
    workflowRunApprovals,
    humanInputRequests,
    locationRequests,
    documentWriteApprovals,
    knowledgeWriteApprovals,
    planApprovals,
  } = useThreadApprovals(organizationId, dataThreadId);

  // Resolved human-input requests — rendered inline in the history with the
  // response + edit affordance (the active subscription above only carries
  // pending/executing rows).
  const { requests: resolvedHumanInputRequests } =
    useResolvedHumanInputRequests(organizationId, dataThreadId);

  // generationStartMs — see agentActivelyWorking / threadMeta above.
  const generationStartMs = threadMeta?.generationStartTime ?? null;

  // A follow-up sent while a turn runs waits in the queue tray and enters the
  // transcript at the pick (persist-at-pick). Its "Thinking · Ns" timer must
  // count from when the agent picked it up, not the whole turn's elapsed
  // time: re-anchor to the latest current-turn follow-up's creation time. The
  // initiating prompt is the first user message at/after the turn start (its
  // save lags markGenerating, so it sorts after generationStartMs); any later
  // one (count >= 2) is a follow-up. Fall back to the server turn-start (which
  // includes the routing wait) for the first response. Completed bubbles latch
  // their own durations / use stored durationMs, so this only resets the
  // in-progress response's live timer.
  // ONE client clock for the whole in-flight turn, latched at send (the
  // optimistic bubble's timestamp) and used until the server's
  // generationStartTime arrives. Every thinking timer (gap-shell
  // ThinkingIndicator + in-bubble MessageThoughtHeader) anchors to this same
  // value, so the indicator→header handoff can't restart the count at "1s":
  // each component's useThinkingTimer otherwise falls back to its OWN
  // mount-time clock, and on a thread's FIRST message the cold threadMeta
  // subscription guarantees the server anchor is still missing at handoff.
  // (Render-time ref mutation is idempotent — same pattern as the key latches
  // in chat-messages.)
  const clientTurnStartRef = useRef<number | null>(null);
  const turnInFlight = isSendPending || agentActivelyWorking;
  const clientTurnStartMs =
    pendingMessage && !pendingMessage.editedMessageId
      ? pendingMessage.timestamp.getTime()
      : turnInFlight
        ? clientTurnStartRef.current
        : null;
  clientTurnStartRef.current = clientTurnStartMs;

  // Server turn-start CONVERTED into the client clock frame — the reload/history
  // fallback (used only when there is no in-session client anchor). Keeps the
  // follow-up (persist-at-pick) re-anchor: the latest current-turn user message's
  // server time once the turn has >=2 user messages, else the turn start.
  const serverStartClientMs = useMemo(() => {
    if (generationStartMs === null) return null;
    let lastFollowUpMs: number | undefined;
    let currentTurnUserCount = 0;
    for (const msg of messages) {
      if (
        msg.role === 'user' &&
        msg._creationTime !== undefined &&
        msg._creationTime >= generationStartMs
      ) {
        currentTurnUserCount += 1;
        lastFollowUpMs = msg._creationTime;
      }
    }
    const rawServer =
      currentTurnUserCount >= 2 && lastFollowUpMs !== undefined
        ? lastFollowUpMs
        : generationStartMs;
    return toClientEpoch(rawServer);
  }, [generationStartMs, messages, toClientEpoch]);

  // The thinking-timer anchor. PREFER the immutable client send time whenever it
  // exists this session: it is present for the whole in-flight turn (latched
  // above) and advances to a follow-up's send time, so the live timer NEVER
  // swaps from a client epoch to a server epoch mid-turn — the cause of the
  // "Thinking · Ns" rewind. The server value (already client-frame) is used only
  // on reload/history. `reanchorKey` flips only on a deliberate re-anchor (new
  // turn / follow-up), which the timer latches on; unrelated recomputes don't.
  const thinkingAnchor = useMemo<ThinkingAnchor>(() => {
    const reanchorKey =
      clientTurnStartMs !== null
        ? `c:${clientTurnStartMs}`
        : serverStartClientMs !== null
          ? `s:${serverStartClientMs}`
          : 'none';
    return {
      clientStartMs: clientTurnStartMs,
      serverStartClientMs,
      reanchorKey,
    };
  }, [clientTurnStartMs, serverStartClientMs]);

  // Merge messages with approvals and human input requests
  const {
    messages: mergedMessages,
    activeApproval,
    activeApprovalInline,
  } = useMergedChatItems({
    messages,
    integrationApprovals,
    workflowCreationApprovals,
    workflowUpdateApprovals,
    workflowRunApprovals,
    humanInputRequests,
    resolvedHumanInputRequests,
    locationRequests,
    documentWriteApprovals,
    knowledgeWriteApprovals,
    planApprovals,
  });

  // Block input when any pending or executing approval exists
  const hasActiveApproval = activeApproval !== null;

  // Whole-page drag & drop: a file dropped ANYWHERE in the chat (not just the
  // composer's drop zone) attaches to the message being composed. Gate it
  // EXACTLY like the composer's own drop zone so the conversation area only
  // accepts a file when the composer would too — an agent is present, the
  // thread isn't read-only/archived, no approval is blocking input, and file
  // upload is enabled for this agent. Drops that land on the composer are
  // handled by its own FileUpload DropZone (which stops propagation), so the
  // two paths never double-handle the same drop.
  const { isDragOver: isPageDragOver } = usePageFileDrop({
    onFilesDropped: uploadFiles,
    disabled:
      readOnly ||
      isArchived ||
      hasNoAgents ||
      hasActiveApproval ||
      fileUploadDisabled,
  });

  // Fork info — for showing divider in forked threads. `threadMeta` (a single
  // getThreadMeta subscription shared with useMessageProcessing) is pulled up
  // above the queued-message filter.
  const forkInfo = threadMeta?.forkInfo ?? undefined;

  // The in-flight turn's resolved Auto route (broadcast mid-turn by the backend),
  // mapped slug → display name so the thinking timeline shows "Routed to X" while
  // the turn is still generating. Null until routing resolves / on idle threads.
  const liveRoute = useMemo(() => {
    const lr = threadMeta?.liveRoute;
    if (!lr) return undefined;
    const agent = agents?.find((a) => a.name === lr.agentSlug);
    return { agentName: agent?.displayName ?? lr.agentSlug, reason: lr.reason };
  }, [threadMeta?.liveRoute, agents]);

  // VISUAL busy state: actively working, or the optimistic pre-confirm window.
  const isLoading = agentActivelyWorking || isSendPending;

  // Queue mode: external-agent thread with a server-confirmed in-flight turn.
  // Keyed on real `isGenerating` (NOT `agentActivelyWorking`) so a message sent
  // during the linger window still routes through the steer queue → held-open
  // stdin (instant delivery), exactly as the steer machinery expects. Only the
  // VISUAL state treats lingering as idle; delivery semantics are unchanged.
  const queueModeActive = isExternalAgentThread && (isGenerating ?? false);

  const { mutateAsync: enqueueMessage } = useEnqueueMessage();
  // Optimistic queue-tray entries for enqueue mutations still in flight —
  // persist-at-pick means there is no transcript bubble to bridge the
  // round-trip, so the tray itself must echo the send instantly.
  const [pendingQueued, setPendingQueued] = useState<PendingTrayEntry[]>([]);
  const pendingQueueSeqRef = useRef(0);

  // Hand off to the authoritative signal the moment it arrives: clear the
  // optimistic flag once the server reports generating, so a fast response
  // (idle < 8s safety timeout) doesn't leave the spinner stuck on.
  useEffect(() => {
    if (isGenerating && dataThreadId) clearSendPending(dataThreadId);
  }, [isGenerating, dataThreadId]);

  // Unread tracking: clear the chat-list "new response" badge by marking the
  // open thread read on open, and again when a generation finishes while the
  // user is viewing it (so a reply that lands in the foreground never
  // badges). Owner-only — skipped for read-only / shared views where the
  // mutation's access check would reject.
  const { mutate: markThreadRead } = useMarkThreadRead();
  const markReadIfOwned = useCallback(() => {
    if (!threadId || readOnly) return;
    markThreadRead(
      { threadId },
      {
        onError: (error) => {
          console.warn('[chat] markThreadRead failed', error);
        },
      },
    );
  }, [threadId, readOnly, markThreadRead]);
  useEffect(() => {
    markReadIfOwned();
  }, [markReadIfOwned]);
  const prevLoadingForReadRef = useRef(isLoading);
  useEffect(() => {
    if (prevLoadingForReadRef.current && !isLoading) {
      markReadIfOwned();
    }
    prevLoadingForReadRef.current = isLoading;
  }, [isLoading, markReadIfOwned]);

  // Stop generating
  const { stopGenerating, resetCancelled } = useStopGenerating({
    threadId: dataThreadId,
  });

  // Auto-clear freeze when loading ends — covers mutation failure, thread
  // navigation, and natural completion without needing explicit .catch()
  useEffect(() => {
    if (!isLoading) {
      resetCancelled();
    }
  }, [isLoading, resetCancelled]);

  // Auto-switch the model selector after a successful fallback. See hook.
  useModelFallbackAutoSwitch({
    messages,
    agentName: effectiveAgent?.name,
    isLoading,
    selectedModelOverrides,
    setSelectedModelOverride,
  });

  const lastUserMessageRef = useRef<HTMLDivElement>(null);

  // Scroll state machine: send-snap (last user message to the viewport top),
  // branch-switch preservation, thread-open restore/bottom, streaming-end
  // intent clear, and load-more prepend preservation. `scrollIntentRef` is
  // shared with `useSendMessage` and the edit-and-branch handler below.
  const {
    containerRef,
    contentRef,
    scrollToBottom,
    showScrollButton,
    scrollIntentRef,
    handleLoadMore,
  } = useChatScroll({
    threadId,
    dataThreadId,
    messagesLength: messages.length,
    isLoading,
    isArenaMode,
    pendingEditedMessageId: pendingMessage?.editedMessageId,
    lastUserMessageRef,
    loadMore,
  });

  // Edit-and-branch swap hold: submitting an edit switches `dataThreadId` to
  // the new branch, whose message subscription starts EMPTY for a few hundred
  // ms — without a hold the whole conversation blanks out and then remounts
  // (the "message box rerenders completely" flash). While the swap settles,
  // keep rendering the last non-empty list (the optimistic truncated view set
  // by handleEditSubmit) and release the moment the branch's real messages
  // land. Render-body refs (not effects) so the hold applies in the same
  // commit the list would otherwise empty in. Cleared on URL-thread change —
  // a real navigation must never resurrect another thread's items.
  const editSwapActiveRef = useRef(false);
  const heldItemsRef = useRef(mergedMessages);
  const heldForThreadRef = useRef(threadId);
  if (heldForThreadRef.current !== threadId) {
    heldForThreadRef.current = threadId;
    editSwapActiveRef.current = false;
  }
  if (pendingMessage?.editedMessageId) editSwapActiveRef.current = true;
  let itemsForRender = mergedMessages;
  if (editSwapActiveRef.current) {
    if (mergedMessages.length === 0 && heldItemsRef.current.length > 0) {
      itemsForRender = heldItemsRef.current;
    } else if (mergedMessages.length > 0 && !pendingMessage?.editedMessageId) {
      editSwapActiveRef.current = false;
      // The branch's real messages land in THIS commit, remounting the list
      // (new keys) — the slack min-height resets and the browser can clamp
      // scrollTop toward the top before the new layout settles, which read
      // as "renders at the final position, jumps to the start, then back".
      // Re-arm the snap so the same commit's content tick re-positions the
      // view (the retargeting glide is a no-op if one is already running).
      scrollIntentRef.current = 'smooth';
    }
  }
  if (itemsForRender === mergedMessages) heldItemsRef.current = mergedMessages;

  const userContext = useUserContext();
  const teamFilter = useOptionalTeamFilter();

  // Client-side budget gate. The server enforces the budget authoritatively
  // (a refused turn), but without this the composer left Send enabled and the
  // user only learned they were over budget after the message landed as an
  // inline turn error (#2345). Reuse the same query the BudgetBanner and the
  // server use; `exceeded` is team-independent (checkBudget always spans all
  // teams for hard blocks), so send is blocked whatever team is selected.
  // Loading returns `undefined` → the gate stays false, never a false block.
  const { data: budgetStatus } = useMyBudgetStatus(
    organizationId,
    teamFilter?.selectedTeamId,
  );
  const budgetExceeded = budgetStatus?.exceeded === true;

  // Projects feature: when the chat was opened from a project's "New
  // chat in this project" CTA, the projectId is passed as a URL search
  // param. Read it loosely (strict: false) so the chat page doesn't
  // need a validateSearch contract — undefined means non-project chat.
  const chatSearch = useSearch({ strict: false }) as
    | Record<string, unknown>
    | undefined;
  const projectIdFromUrl =
    chatSearch && typeof chatSearch.projectId === 'string'
      ? chatSearch.projectId
      : undefined;

  // For an EXISTING project chat the projectId isn't in the URL — read it from
  // the thread (via the consolidated getThreadMeta above) so the composer
  // applies the project's agent/model restrictions and recommendations either
  // way.
  const currentProjectId = threadMeta?.projectId ?? projectIdFromUrl;

  // Pre-warm the prompt cache when the composer is focused so the next message
  // is served warm. No-op until a thread exists (a fresh chat has nothing to
  // prime yet); deduped per (thread, agent, project) within the cache TTL.
  const prewarmChatCache = usePrewarmChatCache({
    threadId: dataThreadId,
    organizationId,
    agentSlug: effectiveAgent?.name,
    projectId: currentProjectId,
  });

  const { sendMessage } = useSendMessage({
    organizationId,
    threadId: dataThreadId,
    messages: rawMessages,
    setPendingThreadId,
    setPendingMessage,
    clearChatState,
    onBeforeSend: () => {
      resetCancelled();
    },
    // Pass the RAW selection (null in Auto mode), NOT `effectiveAgent` — the
    // latter resolves null to the default 'chat-agent', which would make
    // `useSendMessage` send that concrete slug instead of the AUTO_AGENT_SLUG
    // sentinel, silently bypassing `resolveAutoRoute` entirely.
    selectedAgent,
    modelId: modelOverrideKey
      ? selectedModelOverrides[modelOverrideKey]
      : undefined,
    enabledCapabilities,
    userContext,
    arena: arenaContext ?? undefined,
    teamId: teamFilter?.selectedTeamId ?? undefined,
    // Lets the hook skip the per-send guardrails precheck round-trip when the
    // org has no enabled input guardrail (renders + dispatches immediately).
    // `undefined` while flags load → hook runs precheck (safe default).
    inputGuardrailsActive: featureFlags?.inputGuardrailsActive,
    projectId: projectIdFromUrl,
    // Workdir staged from the Sandbox pill before the thread exists — gated
    // to external-agent sends (the only consumers of `sandboxWorkdir`), so a
    // value staged then abandoned for a normal chat never lands as junk
    // metadata on a thread that can't use or clear it.
    pendingSandboxWorkdir: isExternalAgentThread
      ? pendingSandboxWorkdir
      : undefined,
    clearPendingSandboxWorkdir: () => setPendingSandboxWorkdir(''),
    // The hook sets this ref RIGHT BEFORE each setPendingMessage call,
    // so the force-snap intent is fresh when the MutationObserver picks
    // up the new bubble. Previously this was set here in
    // `handleSendMessage` BEFORE the (potentially 50-200ms) await, and a
    // user scroll-up during the await could clear it — breaking
    // auto-scroll for video-link sends specifically (those have an extra
    // `await bindCompletedJobsToMessage` round-trip; plain text and image
    // attachments don't, which is why they always worked).
    scrollIntentRef,
    // Restore the composer chips on send-failure paths inside
    // `useSendMessage` (bind throw, precheck-block, chatWithAgent throw).
    // Mirrors the `setInputValue(draftSnapshot)` rollback we do here
    // for the typed text below.
    unmarkJobsSent: unmarkVideoJobsSent,
    // Same rollback contract for `@`-mention KB reference chips.
    restoreKbMentions,
  });

  const handleSendMessage = async (
    message: string,
    sentAttachments?: FileAttachment[],
    kbReferences?: KbMention[],
  ) => {
    // Queue mode: a turn is running on this external-agent thread — enqueue
    // instead of dispatching. Text-only (ChatInput blocks attachment sends in
    // queue mode). Persist-at-pick: the message renders in the queue TRAY
    // (above the composer) until the agent actually picks it up — it enters
    // the transcript only at the pick, at its final position. The optimistic
    // tray entry below bridges the enqueue round-trip so the send never
    // appears to vanish.
    if (queueModeActive && dataThreadId && activeAgentMeta?.name) {
      const draftSnapshot = inputValue;
      clearInputValue();
      const pendingKey = `pq-${pendingQueueSeqRef.current++}`;
      setPendingQueued((prev) => [...prev, { key: pendingKey, text: message }]);
      try {
        const queuedModelId = modelOverrideKey
          ? selectedModelOverrides[modelOverrideKey]
          : undefined;
        await enqueueMessage({
          threadId: dataThreadId,
          organizationId,
          message,
          agentSlug: activeAgentMeta.name,
          // Carry the picked model so the boundary drain re-enters generation
          // with it, not the org default (a single-model session VK 403s on
          // the wrong one).
          ...(queuedModelId !== undefined && { modelId: queuedModelId }),
        });
        // Mutation resolution implies the local store already reflects the
        // committed row (own-mutation consistency) — the server entry takes
        // over in the same commit this optimistic one leaves.
        setPendingQueued((prev) => prev.filter((e) => e.key !== pendingKey));
      } catch (err) {
        setInputValue(draftSnapshot);
        // Roll back the optimistic tray entry — the message never made it to
        // the queue (QUEUE_FULL / network blip).
        setPendingQueued((prev) => prev.filter((e) => e.key !== pendingKey));
        const data: unknown = err instanceof ConvexError ? err.data : null;
        const code =
          typeof data === 'object' &&
          data !== null &&
          'code' in data &&
          typeof data.code === 'string'
            ? data.code
            : undefined;
        toast({
          title:
            code === 'QUEUE_FULL' ? t('queue.full') : t('toast.sendFailed'),
          variant: 'destructive',
        });
      }
      return;
    }
    // Scroll-intent now set inside `useSendMessage` adjacent to each
    // setPendingMessage call — see `scrollIntentRef` prop above. Setting
    // it here would re-introduce the video-link race window where a
    // 50-200 ms `await bindCompletedJobsToMessage` lets a user scroll-up
    // clear the pending snap before the optimistic bubble lands.
    // Snapshot the input value BEFORE clearing so a failed send can
    // restore the typed text. Without this, a network blip / model-
    // access denial / chat-filter block in `sendMessage` leaves the
    // composer empty and the user has to retype the whole prompt.
    // Mirror the chip-unbind rollback (`useSendMessage` already does
    // that on failure) so both typed text and attachments survive.
    const draftSnapshot = inputValue;

    // Snapshot the completed video-link chips at click-time. Mirror the
    // server's bind-mutation predicate (mutations.ts:540 +
    // queries.ts:projectJob) so the snapshot, the bg bind, and the
    // optimistic markdown all agree on which chips are "ready to send".
    // Hiding the chips synchronously here (`markVideoJobsSent`) is what
    // makes the composer empty in the same React commit as
    // `clearInputValue()` — without this, the chip lingers in the
    // composer for the 50-200 ms `bindCompletedJobsToMessage` round-trip
    // and the user reads it as "the input box doesn't clear quickly".
    const videoLinkSnapshot = videoLinkJobs.filter(
      (j) =>
        j.displayStatus === 'completed' &&
        j.messageBoundAt === undefined &&
        j.lifecycleStatus !== 'trashed' &&
        j.storageId !== undefined,
    );
    const snapshotJobIds = videoLinkSnapshot.map((j) => j.jobId);
    if (snapshotJobIds.length > 0) {
      markVideoJobsSent(snapshotJobIds);
    }
    clearInputValue();

    // For image-generation agents, if an editing image is active in the
    // banner and not dismissed, prepend it as the reference attachment.
    let finalAttachments = sentAttachments;
    if (
      isImageGenAgent &&
      currentModelSupportsEdit &&
      activeEditingImage &&
      activeEditingImage.ref.fileId
    ) {
      const imageAtt = imageRefToAttachment(activeEditingImage.ref);
      if (imageAtt) {
        finalAttachments = [
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- FileAttachment.fileId is a branded Id<'_storage'>; runtime value is the same string the server accepts.
          imageAtt as unknown as FileAttachment,
          ...(sentAttachments ?? []),
        ];
      }
      // Consume: clear explicit ref. dismissedImageKey reset naturally when a
      // new image lands because its key differs.
      setEditingImageRef(null);
      setDismissedImageKey(null);
    }

    try {
      await sendMessage(
        message,
        finalAttachments,
        videoLinkSnapshot,
        kbReferences,
      );
    } catch (err) {
      // Restore the draft so the user can retry or edit. The chip
      // unbind already happens inside `useSendMessage`'s catch via the
      // `unmarkJobsSent` prop wired above; KB mention chips are restored
      // there too via `restoreKbMentions`.
      setInputValue(draftSnapshot);
      throw err;
    }
  };

  // No client-side optimistic loading needed — server sets
  // generationStatus='generating' when the agent resumes and the
  // Convex subscription delivers it in real-time.
  const handleHumanInputResponseSubmitted = useCallback(() => {
    // Generation resumes server-side once the human-input response is saved, but
    // the `isGenerating` subscription lags that round-trip — so without this the
    // thinking line doesn't render until the server flips generating. Flip the
    // optimistic pending flag NOW (same as a normal send) so `isLoading` is true
    // immediately; the effect above clears it when real `isGenerating` arrives.
    if (dataThreadId) markSendPending(dataThreadId);
  }, [dataThreadId]);

  const handleSendFollowUp = useCallback(
    (message: string) => {
      setInputValue(message);
    },
    [setInputValue],
  );

  const handleSendMessageDirect = useCallback(
    (message: string) => {
      // Scroll-intent set inside `useSendMessage` (see scrollIntentRef
      // wiring above). Setting it here would re-introduce the race.
      void sendMessage(message);
    },
    [sendMessage],
  );

  // Edit message → open dialog → create branch on submit
  const { selectNewBranch, rootThreadId } = useBranchContext();
  const { mutateAsync: editAndBranchAction } = useEditAndBranch();

  const [editingMessage, setEditingMessage] = useState<{
    id: string;
    content: string;
  } | null>(null);

  const handleEditClick = useCallback((messageId: string, content: string) => {
    setEditingMessage({ id: messageId, content });
  }, []);

  // Stable identities for the two props ChatMessages would otherwise receive as
  // fresh inline arrows each render — required for its React.memo to hold.
  const handleEditCancel = useCallback(() => {
    setEditingMessage(null);
  }, []);

  const handleSavePromptFromMessage = useCallback(
    (messageId: string, content: string) => {
      setSavePromptData({ messageId, content });
    },
    [],
  );

  const handleEditSubmit = useCallback(
    async (newContent: string) => {
      if (!editingMessage || !dataThreadId) return;
      // `editAndBranch` needs a CONCRETE agent (it resolves the agent config;
      // it can't take the Auto sentinel). If the roster hasn't resolved the
      // effective agent yet, surface it instead of silently swallowing the
      // edit (which read as "editing does nothing").
      if (!effectiveAgent) {
        toast({ title: t('toast.sendFailed'), variant: 'destructive' });
        return;
      }
      const modelId = effectiveAgent.name
        ? selectedModelOverrides[effectiveAgent.name]
        : undefined;

      // Optimistic: show edited content immediately, truncate messages after it.
      // Cleared by usePendingMessages when dataThreadId changes (branch loads).
      setPendingMessage({
        content: newContent,
        threadId: dataThreadId,
        timestamp: new Date(),
        editedMessageId: editingMessage.id,
      });
      if (dataThreadId) markSendPending(dataThreadId);

      // Close inline editor so the optimistic content is visible
      setEditingMessage(null);

      // Glide to the edited message like a normal send (smooth retargeting
      // snap — see ChatScroll.scrollIntentRef).
      scrollIntentRef.current = 'smooth';

      try {
        const result = await editAndBranchAction({
          sourceThreadId: dataThreadId,
          rootThreadId: rootThreadId ?? dataThreadId,
          editedMessageId: editingMessage.id,
          newMessage: newContent,
          organizationId,
          agentSlug: effectiveAgent.name,
          modelId,
          userContext,
        });
        selectNewBranch(String(result.forkOrder), result.branchThreadId);
      } catch (err) {
        // Roll back the optimistic edit and tell the user. Without this the
        // editor closes, the branch never appears, and the failure is silent —
        // e.g. the selected model's provider has no API key, or agent-config
        // resolution failed server-side ("editing does nothing").
        console.error('[chat] edit-and-branch failed', err);
        setPendingMessage(null);
        toast({
          title: t('toast.sendFailed'),
          description: err instanceof Error ? err.message : undefined,
          variant: 'destructive',
        });
      }
    },
    [
      editingMessage,
      dataThreadId,
      rootThreadId,
      effectiveAgent,
      selectedModelOverrides,
      organizationId,
      userContext,
      editAndBranchAction,
      selectNewBranch,
      setPendingMessage,
      scrollIntentRef,
      toast,
      t,
    ],
  );

  // Regenerate a specific assistant message: re-run the preceding user
  // message unchanged through edit-and-branch, producing a sibling branch
  // (the BranchNavigator then lets the user flip between attempts). Reuses
  // the same machinery as handleEditSubmit, just with the original prompt.
  const handleRegenerateMessage = useCallback(
    (assistantMessageId: string) => {
      if (!dataThreadId || !effectiveAgent) return;
      const idx = messages.findIndex((msg) => msg.id === assistantMessageId);
      if (idx < 0) return;
      let userMessage: (typeof messages)[number] | undefined;
      for (let i = idx - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          userMessage = messages[i];
          break;
        }
      }
      if (!userMessage?.content) return;

      const modelId = effectiveAgent.name
        ? selectedModelOverrides[effectiveAgent.name]
        : undefined;

      setPendingMessage({
        content: userMessage.content,
        threadId: dataThreadId,
        timestamp: new Date(),
        editedMessageId: userMessage.id,
      });
      if (dataThreadId) markSendPending(dataThreadId);
      // Glide like a normal send (smooth — see ChatScroll.scrollIntentRef).
      scrollIntentRef.current = 'smooth';

      void (async () => {
        try {
          const result = await editAndBranchAction({
            sourceThreadId: dataThreadId,
            rootThreadId: rootThreadId ?? dataThreadId,
            editedMessageId: userMessage.id,
            newMessage: userMessage.content,
            organizationId,
            agentSlug: effectiveAgent.name,
            modelId,
            userContext,
          });
          selectNewBranch(String(result.forkOrder), result.branchThreadId);
        } catch (error) {
          console.error('Failed to regenerate message:', error);
          setPendingMessage(null);
          toast({ title: t('regenerateFailed'), variant: 'destructive' });
        }
      })();
    },
    [
      messages,
      dataThreadId,
      rootThreadId,
      effectiveAgent,
      selectedModelOverrides,
      organizationId,
      userContext,
      editAndBranchAction,
      selectNewBranch,
      setPendingMessage,
      scrollIntentRef,
      toast,
      t,
    ],
  );

  // Fork at message — create a new thread with messages up to the selected one
  const { mutate: forkOwnThread } = useForkOwnThread();

  const handleForkAtMessage = useCallback(
    (messageId: string) => {
      if (!dataThreadId) return;

      const msg = rawMessages.find((rm) => rm.id === messageId);
      if (msg?.order === undefined) return;

      forkOwnThread(
        { threadId: dataThreadId, upToMessageOrder: msg.order },
        {
          onSuccess: (newThreadId) => {
            void navigate({
              to: '/dashboard/$id/chat/$threadId',
              params: { id: organizationId, threadId: newThreadId },
            });
            toast({ title: t('forkSuccess'), variant: 'success' });
          },
          onError: (error) => {
            console.error('Failed to fork chat:', error);
            toast({ title: t('forkFailed'), variant: 'destructive' });
          },
        },
      );
    },
    [
      dataThreadId,
      rawMessages,
      organizationId,
      forkOwnThread,
      navigate,
      toast,
      t,
    ],
  );

  const handleRetry = useCallback(() => {
    const lastUserMessage = messages
      .toReversed()
      .find((msg) => msg.role === 'user');
    if (!lastUserMessage?.content) return;
    // Scroll-intent set inside `useSendMessage` adjacent to each
    // setPendingMessage call — see scrollIntentRef wiring above.
    void sendMessage(lastUserMessage.content);
  }, [messages, sendMessage]);

  // Arena mode: mount ArenaSplitView as soon as we're in arena mode and
  // either have thread IDs or are mid-send (pendingMessage set synchronously
  // by useSendMessage). ArenaSplitView's ArenaColumnSkeleton handles the
  // null-threadId case, eliminating the white flash during thread creation.
  // The `messages.length === 0` guard avoids hiding existing thread messages
  // during the "enable arena on existing thread" transition.
  const showArena =
    !!arenaContext?.isArenaMode &&
    (!!arenaContext.arenaThreadIdA ||
      (pendingMessage != null && messages.length === 0));

  // While cleanupArenaBranch is running the underlying messages are being
  // rewritten (verdict='b_better' wipes Thread A and copies B's messages in).
  // Render a skeleton in this window so the user doesn't see the pre-cleanup
  // Thread A content flash before the new messages arrive.
  const showExitingSkeleton =
    !showArena && !!arenaContext?.isExitingArena && !!dataThreadId;

  const showMessages =
    !showArena &&
    !showExitingSkeleton &&
    (dataThreadId || messages.length > 0 || pendingMessage || isLoading);
  const showWelcome = !showMessages && !showArena && !showExitingSkeleton;

  return (
    <Stack
      role="region"
      aria-labelledby={chatRegionLabelId}
      gap={0}
      className="h-full min-h-0 flex-1"
    >
      <h2 id={chatRegionLabelId} className="sr-only">
        {t('aria.chatRegion')}
      </h2>
      <PageDropOverlay show={isPageDragOver} />
      {showArena ? (
        // md:pt-13 clears the floating glass top bar (an absolute overlay on
        // the message column) so the arena's own toolbars stay visible.
        <div className="flex min-h-0 flex-1 flex-col md:pt-13">
          <ArenaSplitView organizationId={organizationId} />
        </div>
      ) : (
        // Dedicated scroller. The chat input footer is a flex SIBLING below —
        // never inside the scroll container — so it cannot move with content
        // (a sticky footer inside the scroller jittered during fast scrolling
        // and programmatic re-pins).
        // No `scroll-smooth`: the auto-follow pins to the bottom with explicit
        // instant scrolls (see useChatScroll). A CSS smooth-behavior would make
        // every pin animate against the still-settling response slack and land
        // short. The scroll-to-bottom button opts into smooth explicitly.
        <Stack
          ref={containerRef}
          gap={0}
          className="min-h-0 flex-1 overflow-y-auto will-change-transform"
        >
          <div
            ref={contentRef}
            className={cn(
              // md:pt-19 = the floating glass top bar (52px) + the list's own
              // 24px breathing room: at rest content clears the bar; once
              // scrolled it slides beneath the blur (the scroller spans the
              // full column height behind the overlay). Send-snap / response
              // slack read this padding-top as their top inset so a just-sent
              // bubble stays fully visible under the glass, not at 16px.
              'flex flex-col overflow-y-visible p-4 sm:p-6 md:pt-19',
              showWelcome && 'flex-1 justify-center',
            )}
          >
            {showWelcome && (
              <WelcomeView
                isAgentLoading={isAgentLoading}
                agentName={effectiveAgent?.displayName}
                conversationStarters={effectiveAgent?.conversationStarters}
                onSuggestionClick={(starter) => {
                  // Starters fill the composer; when the composer is hard-
                  // disabled for a missing API key the fill would sit under
                  // the absolute reason overlay and double-print. Skip until
                  // a key exists (the Open-provider-settings CTA is the path).
                  if (missingKeyBlocked) return;
                  setInputValue(starter);
                }}
              />
            )}

            {showExitingSkeleton && (
              // Arena-exit window: the underlying messages are being rewritten
              // (verdict='b_better' wipes Thread A and copies B's in), so no real
              // bubbles exist yet. Reuse the shared message-column skeleton so the
              // swap into real content doesn't shift the viewport.
              <ChatMessagesSkeleton />
            )}

            {showMessages && (
              <ChatMessagesErrorBoundary
                organizationId={organizationId}
                threadId={dataThreadId}
              >
                {/* One thread-level metadata subscription shared by every bubble
                  (collapses N per-message subscriptions into 1). MessageBubble's
                  useMessageMetadata reads from this map, falling back to a
                  per-message query for rows not yet in the batch. */}
                <ThreadMessageMetadataProvider
                  threadId={dataThreadId ?? null}
                  liveRoute={liveRoute ?? null}
                  thinkingAnchor={thinkingAnchor}
                >
                  <SteerStatusProvider
                    threadId={dataThreadId}
                    organizationId={organizationId}
                  >
                    <ChatMessages
                      items={itemsForRender}
                      threadId={dataThreadId}
                      organizationId={organizationId}
                      canLoadMore={canLoadMore}
                      isLoadingMore={isLoadingMore}
                      loadMore={handleLoadMore}
                      isLoading={isLoading}
                      isSendPending={isSendPending}
                      isAutoRoute={isAutoRoute}
                      liveRoute={liveRoute}
                      thinkingAnchor={thinkingAnchor}
                      isQueued={threadMeta?.isQueued ?? false}
                      liveAssistantMessageId={
                        sessionProgress?.status === 'running'
                          ? (sessionProgress.assistantMessageId ?? null)
                          : null
                      }
                      lastUserMessageRef={lastUserMessageRef}
                      containerRef={containerRef}
                      activeApproval={activeApproval}
                      activeApprovalInline={activeApprovalInline}
                      forkedMessageCount={
                        forkInfo?.forkedMessageCount ?? undefined
                      }
                      lastForkedMessageOrder={
                        forkInfo?.lastForkedMessageOrder ?? undefined
                      }
                      forkedAt={forkInfo?.forkedAt ?? undefined}
                      forkedFromShare={forkInfo?.forkedFromShare}
                      onHumanInputResponseSubmitted={
                        handleHumanInputResponseSubmitted
                      }
                      onSendFollowUp={
                        isArchived || readOnly ? undefined : handleSendFollowUp
                      }
                      onSendMessage={
                        isArchived || readOnly
                          ? undefined
                          : handleSendMessageDirect
                      }
                      onEditMessage={
                        isArchived || readOnly ? undefined : handleEditClick
                      }
                      onForkAtMessage={
                        isArchived || readOnly ? undefined : handleForkAtMessage
                      }
                      onSavePrompt={handleSavePromptFromMessage}
                      onUnsavePrompt={handleUnsavePrompt}
                      savedMessageMap={savedMessageMap}
                      onRetry={isArchived || readOnly ? undefined : handleRetry}
                      onRegenerate={
                        isArchived || readOnly
                          ? undefined
                          : handleRegenerateMessage
                      }
                      editingMessageId={
                        isArchived || readOnly ? undefined : editingMessage?.id
                      }
                      editingMessageContent={
                        isArchived || readOnly
                          ? undefined
                          : editingMessage?.content
                      }
                      onEditSubmit={
                        isArchived || readOnly ? undefined : handleEditSubmit
                      }
                      onEditCancel={
                        isArchived || readOnly ? undefined : handleEditCancel
                      }
                      hideFeedback={isArchived}
                    />
                  </SteerStatusProvider>
                </ThreadMessageMetadataProvider>
              </ChatMessagesErrorBoundary>
            )}
          </div>
        </Stack>
      )}

      {/* Floating "Quote" affordance on text selection inside messages.
          Portals to <body>, so placement here is just for lifecycle. */}
      {!readOnly && <SelectionQuoteButton containerRef={containerRef} />}

      <PanelFooter className="bg-background/95 backdrop-blur-xs">
        <div className="relative mx-auto w-full max-w-(--chat-max-width)">
          <ScrollToBottomButton
            show={showScrollButton}
            onClick={scrollToBottom}
          />
        </div>
        {readOnly ? (
          <ReadOnlyBanner />
        ) : isArchived ? (
          <ArchivedBanner
            isUnarchiving={isUnarchiving}
            onUnarchive={() => {
              if (threadId) {
                unarchiveThread({ threadId });
              }
            }}
          />
        ) : threadStatusPending ? null : (
          <FileUpload.Root>
            <div className="px-3">
              {isExternalAgentThread && dataThreadId && (
                <QueuedMessageTray
                  threadId={dataThreadId}
                  organizationId={organizationId}
                  pending={pendingQueued}
                />
              )}
              {isImageGenAgent && threadImages.length > 0 && (
                <div className="mx-auto w-full max-w-(--chat-max-width)">
                  <EditingBanner
                    threadImages={threadImages}
                    currentModelSupportsEdit={currentModelSupportsEdit}
                    currentModelLabel={currentModelLabel}
                  />
                </div>
              )}
              <ChatInput
                className="mx-auto w-full max-w-(--chat-max-width)"
                placeholder={
                  queueModeActive
                    ? agentLingeringSteerReady
                      ? t('queue.placeholderIdle')
                      : t('queue.placeholder')
                    : isImageGenAgent
                      ? activeEditingImage && currentModelSupportsEdit
                        ? t('imageEdit.placeholder')
                        : t('imageEdit.placeholderCreate')
                      : t('placeholder')
                }
                value={inputValue}
                onChange={setInputValue}
                onSendMessage={handleSendMessage}
                onStopGenerating={
                  agentActivelyWorking ? stopGenerating : undefined
                }
                isLoading={isLoading}
                queueModeActive={queueModeActive}
                disabled={hasNoAgents || hasActiveApproval || missingKeyBlocked}
                disabledReason={
                  hasNoAgents
                    ? 'no-agents'
                    : hasActiveApproval
                      ? 'pending-approval'
                      : missingKeyBlocked
                        ? 'no-api-key'
                        : undefined
                }
                disabledMessage={
                  missingKeyBlocked
                    ? activeModelMissingApiKey
                      ? t('modelSelector.noApiKey')
                      : t('modelSelector.noProviderKey')
                    : undefined
                }
                organizationId={organizationId}
                projectId={currentProjectId}
                threadId={dataThreadId}
                onComposerActivate={prewarmChatCache}
                attachments={attachments}
                uploadingFiles={uploadingFiles}
                uploadFiles={uploadFiles}
                cancelUpload={cancelUpload}
                removeAttachment={removeAttachment}
                clearAttachments={clearAttachments}
                fileUploadDisabled={fileUploadDisabled}
                isIndexing={isIndexing}
                indexingStatuses={indexingStatuses}
                isTranscribing={isTranscribing || isTranscriptionQueryLoading}
                transcriptionStatuses={transcriptionStatuses}
                hasFailedAudioJobs={hasFailedAudioJobs}
                retryAudioTranscription={retryAttachmentTranscription}
                videoLinkJobs={videoLinkJobs}
                isProcessingVideo={isProcessingVideo}
                hasFailedVideoJobs={hasFailedVideoJobs}
                ingestVideoUrlsFromText={ingestVideoUrlsFromText}
                cancelVideoJob={cancelVideoJob}
                retryVideoJob={retryVideoJob}
                sendBlocked={budgetExceeded || imageEditBlocked}
                sendBlockedReason={
                  budgetExceeded
                    ? t('budgetExceededDefault')
                    : imageEditBlocked
                      ? t('imageEdit.modelCannotEdit')
                      : undefined
                }
                onSavePrompt={(content) =>
                  setSavePromptData({ messageId: '', content })
                }
                onOpenPromptLibrary={() => setPromptLibraryOpen(true)}
                kbMentions={kbMentions}
                addKbMention={addKbMention}
                removeKbMention={removeKbMention}
                clearKbMentions={clearKbMentions}
              />
            </div>
          </FileUpload.Root>
        )}
      </PanelFooter>

      <SavePromptDialog
        open={savePromptData !== null}
        onOpenChange={(open) => {
          if (!open) setSavePromptData(null);
        }}
        initialContent={savePromptData?.content ?? ''}
        sourceMessageId={savePromptData?.messageId}
      />

      <PromptLibraryDialog
        open={promptLibraryOpen}
        onOpenChange={setPromptLibraryOpen}
        onSelectPrompt={(content) => {
          setInsertedPrompt(content);
        }}
      />
    </Stack>
  );
}
