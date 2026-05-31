'use client';

import { Button } from '@tale/ui/button';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { m, AnimatePresence } from 'framer-motion';
import { Archive, ArrowDown, Share } from 'lucide-react';
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
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
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
import { useMyFeatureFlags } from '../../settings/governance/hooks/queries';
import { useListProviders } from '../../settings/providers/hooks/queries';
import { useBranchContext } from '../context/branch-context';
import { useChatLayout } from '../context/chat-layout-context';
import {
  useEditAndBranch,
  useForkOwnThread,
  useMarkThreadRead,
  useUnarchiveThread,
} from '../hooks/mutations';
import { useChatAgents, useThreadStatus } from '../hooks/queries';
import { useArenaThreadSetup } from '../hooks/use-arena-thread-setup';
import { useChatScroll } from '../hooks/use-chat-scroll';
import { useChatVideoLinks } from '../hooks/use-chat-video-links';
import { useConvexFileUpload } from '../hooks/use-convex-file-upload';
import { useEffectiveAgent } from '../hooks/use-effective-agent';
import { useFileIndexingStatus } from '../hooks/use-file-indexing-status';
import { useFileTranscriptionStatus } from '../hooks/use-file-transcription-status';
import { useMergedChatItems } from '../hooks/use-merged-chat-items';
import { useMessageProcessing } from '../hooks/use-message-processing';
import { useModelFallbackAutoSwitch } from '../hooks/use-model-fallback-auto-switch';
import { usePendingMessages } from '../hooks/use-pending-messages';
import { useIsSendPending, clearSendPending } from '../hooks/use-pending-send';
import { usePersistedAttachments } from '../hooks/use-persisted-attachments';
import { useSendMessage } from '../hooks/use-send-message';
import { useStopGenerating } from '../hooks/use-stop-generating';
import { useStreamingToolBridge } from '../hooks/use-streaming-tool-bridge';
import { useThreadApprovals } from '../hooks/use-thread-approvals';
import { useThreadImages } from '../hooks/use-thread-images';
import { useUserContext } from '../hooks/use-user-context';
import type { FileAttachment } from '../types';
import { useArenaModeOptional } from './arena/arena-mode-context';
import { ArenaSplitView } from './arena/arena-split-view';
import { ChatInput } from './chat-input';
import { ChatMessages } from './chat-messages';
import { ChatMessagesErrorBoundary } from './chat-messages-error-boundary';
import { EditingBanner, imageRefToAttachment } from './editing-banner';
import { useEffectiveEditingImage } from './editing-banner';
import { SelectionQuoteButton } from './selection-quote-button';
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

const PLACEHOLDER_MESSAGE_ROWS: Array<{
  role: 'user' | 'assistant';
  widths: string[];
}> = [
  { role: 'user', widths: ['w-40'] },
  { role: 'assistant', widths: ['w-full', 'w-5/6', 'w-2/3'] },
  { role: 'user', widths: ['w-56'] },
  { role: 'assistant', widths: ['w-full', 'w-4/5'] },
];

interface ChatInterfaceProps {
  organizationId: string;
  threadId?: string;
  readOnly?: boolean;
}

export function ChatInterface({
  organizationId,
  threadId,
  readOnly = false,
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
    composerProfiles,
    insertedPrompt,
    setInsertedPrompt,
  } = useChatLayout();

  const arenaContext = useArenaModeOptional();
  const isArenaMode = arenaContext?.isArenaMode ?? false;

  // Arena thread-pair lifecycle (create Thread B, exit-on-new-chat). See hook.
  useArenaThreadSetup({ organizationId, threadId });

  const { activeBranchThreadId } = useBranchContext();
  // Use the active branch thread for data loading, but keep URL threadId for drafts/routing
  const dataThreadId = activeBranchThreadId ?? threadId;

  const { agent: effectiveAgent, isLoading: isAgentLoading } =
    useEffectiveAgent(organizationId);

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

  const {
    attachments,
    setAttachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    retryAttachmentTranscription,
    clearAttachments,
  } = useConvexFileUpload({ organizationId, threadId });

  const { isIndexing, statusMap: indexingStatuses } =
    useFileIndexingStatus(attachments);

  const {
    isTranscribing,
    isQueryLoading: isTranscriptionQueryLoading,
    statusMap: transcriptionStatuses,
    hasFailedAudioJobs,
  } = useFileTranscriptionStatus(attachments);

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

  // Agent availability — disable input when no agents exist
  const { agents } = useChatAgents(organizationId);
  const hasNoAgents = agents !== undefined && agents.length === 0;

  // Image-generation agent derivations for EditingBanner.
  const activeAgentMeta = useMemo(
    () => agents?.find((a) => a.name === effectiveAgent?.name),
    [agents, effectiveAgent?.name],
  );
  const isImageGenAgent =
    activeAgentMeta?.primaryBehavior === 'image-generation';
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
  const { active: activeEditingImage } = useEffectiveEditingImage(threadImages);
  const { setEditingImageRef, setDismissedImageKey } = useChatLayout();

  // Thread status — disable input for archived threads
  // Always check the URL threadId (root thread), not dataThreadId (which may
  // be a branch thread that wasn't individually archived).
  const threadStatus = useThreadStatus(threadId, organizationId);
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
  } = useThreadApprovals(organizationId, dataThreadId);

  // Merge messages with approvals and human input requests
  const { messages: mergedMessages, activeApproval } = useMergedChatItems({
    messages,
    integrationApprovals,
    workflowCreationApprovals,
    workflowUpdateApprovals,
    workflowRunApprovals,
    humanInputRequests,
    locationRequests,
    documentWriteApprovals,
  });

  // Block input when any pending or executing approval exists
  const hasActiveApproval = activeApproval !== null;

  // Fork info — for showing divider in forked threads
  const { data: forkInfo } = useConvexQuery(
    api.threads.queries.getThreadForkInfo,
    dataThreadId ? { threadId: dataThreadId } : 'skip',
  );

  // Server-derived generation status (reactive Convex subscription)
  const { data: isGenerating } = useConvexQuery(
    api.threads.queries.isThreadGenerating,
    dataThreadId ? { threadId: dataThreadId } : 'skip',
  );

  // Client-side optimistic flag — set on send click, released when the
  // server subscription confirms or the send fails. Closes the ~200–550 ms
  // gap between click and `chatWithAgent` completing `markGenerating`
  // (Node action cold start + round trips). VISUAL state only — the Stop
  // button below reads real `isGenerating` via `onStopGenerating` gating.
  const isSendPending = useIsSendPending(dataThreadId);
  const isLoading = (isGenerating ?? false) || isSendPending;

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
    if (prevLoadingForReadRef.current && !isLoading) markReadIfOwned();
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

  // Scroll state machine: auto-follow (ChatGPT-style), branch-switch
  // preservation, thread-init scroll, streaming-end intent clear, and
  // load-more prepend preservation. `scrollIntentRef` is shared with
  // `useSendMessage` and the edit-and-branch handler below. See hook.
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
    loadMore,
  });

  const userContext = useUserContext();
  const teamFilter = useOptionalTeamFilter();

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
    selectedAgent: effectiveAgent,
    modelId: effectiveAgent?.name
      ? selectedModelOverrides[effectiveAgent.name]
      : undefined,
    enabledCapabilities,
    composerProfiles,
    userContext,
    arena: arenaContext ?? undefined,
    teamId: teamFilter?.selectedTeamId ?? undefined,
    projectId: projectIdFromUrl,
    // The hook sets this ref RIGHT BEFORE each setPendingMessage call,
    // so the auto-scroll intent is fresh when the MutationObserver
    // picks up the new bubble. Previously this was set here in
    // `handleSendMessage` BEFORE the (potentially 50-200ms) await, and
    // unrelated observer fires during the await would downgrade the
    // ref to 'instant' or clear it — breaking auto-scroll for video-
    // link sends specifically (those have an extra `await
    // bindCompletedJobsToMessage` round-trip; plain text and image
    // attachments don't, which is why they always worked).
    scrollIntentRef,
    // Restore the composer chips on send-failure paths inside
    // `useSendMessage` (bind throw, precheck-block, chatWithAgent throw).
    // Mirrors the `setInputValue(draftSnapshot)` rollback we do here
    // for the typed text below.
    unmarkJobsSent: unmarkVideoJobsSent,
  });

  const handleSendMessage = async (
    message: string,
    sentAttachments?: FileAttachment[],
  ) => {
    // Scroll-intent now set inside `useSendMessage` adjacent to each
    // setPendingMessage call — see `scrollIntentRef` prop above. Setting
    // it here would re-introduce the video-link race window where a
    // 50-200 ms `await bindCompletedJobsToMessage` lets observer fires
    // downgrade the ref before the optimistic bubble lands.
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
      await sendMessage(message, finalAttachments, videoLinkSnapshot);
    } catch (err) {
      // Restore the draft so the user can retry or edit. The chip
      // unbind already happens inside `useSendMessage`'s catch via the
      // `unmarkJobsSent` prop wired above.
      setInputValue(draftSnapshot);
      throw err;
    }
  };

  // No client-side optimistic loading needed — server sets
  // generationStatus='generating' when the agent resumes and the
  // Convex subscription delivers it in real-time.
  const handleHumanInputResponseSubmitted = useCallback(() => {}, []);

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

  const handleEditSubmit = useCallback(
    async (newContent: string) => {
      if (!editingMessage || !dataThreadId || !effectiveAgent) return;
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

      // Close inline editor so the optimistic content is visible
      setEditingMessage(null);

      // Scroll to bottom so the edited message + incoming AI response are visible
      scrollIntentRef.current = 'smooth';

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
    <div
      ref={containerRef}
      role="region"
      aria-labelledby={chatRegionLabelId}
      className={cn(
        'flex h-full min-h-0 flex-1 flex-col',
        !showArena && 'overflow-y-auto scroll-smooth will-change-transform',
      )}
    >
      <h2 id={chatRegionLabelId} className="sr-only">
        {t('aria.chatRegion')}
      </h2>
      {showArena ? (
        <ArenaSplitView organizationId={organizationId} />
      ) : (
        <div
          ref={contentRef}
          className={cn(
            'flex flex-col overflow-y-visible p-4 sm:p-6',
            showWelcome && 'flex-1 justify-center',
          )}
        >
          {showWelcome && (
            <WelcomeView
              isAgentLoading={isAgentLoading}
              agentName={effectiveAgent?.displayName}
              conversationStarters={effectiveAgent?.conversationStarters}
              onSuggestionClick={setInputValue}
            />
          )}

          {showExitingSkeleton && (
            // Arena-exit window: the underlying messages are being rewritten
            // (verdict='b_better' wipes Thread A and copies B's in), so no real
            // bubbles exist yet. Render the REAL message-list structure
            // (mirrors ChatMessages' non-virtual `mx-auto … gap-3 pt-6` column)
            // with placeholder rows, each masked by SkeletonBox inside
            // <Skeletonize loading>, so the swap into real content doesn't shift
            // the viewport.
            <Skeletonize loading label={t('skeleton.loadingMessage')}>
              <div className="mx-auto flex w-full max-w-(--chat-max-width) flex-col gap-3 pt-6">
                {PLACEHOLDER_MESSAGE_ROWS.map((row, rowIdx) => (
                  <div
                    key={rowIdx}
                    className={cn(
                      'flex flex-col gap-2',
                      row.role === 'user' ? 'items-end' : 'items-start',
                    )}
                  >
                    {row.widths.map((w, i) => (
                      <SkeletonBox key={i} fullWidth>
                        <div className={cn('h-4', w)} />
                      </SkeletonBox>
                    ))}
                  </div>
                ))}
              </div>
            </Skeletonize>
          )}

          {showMessages && (
            <ChatMessagesErrorBoundary
              organizationId={organizationId}
              threadId={dataThreadId}
            >
              <ChatMessages
                items={mergedMessages}
                threadId={dataThreadId}
                organizationId={organizationId}
                canLoadMore={canLoadMore}
                isLoadingMore={isLoadingMore}
                loadMore={handleLoadMore}
                isLoading={isLoading}
                lastUserMessageRef={lastUserMessageRef}
                containerRef={containerRef}
                activeApproval={activeApproval}
                forkedMessageCount={forkInfo?.forkedMessageCount ?? undefined}
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
                  isArchived || readOnly ? undefined : handleSendMessageDirect
                }
                onEditMessage={
                  isArchived || readOnly ? undefined : handleEditClick
                }
                onForkAtMessage={
                  isArchived || readOnly ? undefined : handleForkAtMessage
                }
                onSavePrompt={(messageId, content) =>
                  setSavePromptData({ messageId, content })
                }
                onUnsavePrompt={handleUnsavePrompt}
                savedMessageMap={savedMessageMap}
                onRetry={isArchived || readOnly ? undefined : handleRetry}
                onRegenerate={
                  isArchived || readOnly ? undefined : handleRegenerateMessage
                }
                editingMessageId={
                  isArchived || readOnly ? undefined : editingMessage?.id
                }
                editingMessageContent={
                  isArchived || readOnly ? undefined : editingMessage?.content
                }
                onEditSubmit={
                  isArchived || readOnly ? undefined : handleEditSubmit
                }
                onEditCancel={
                  isArchived || readOnly
                    ? undefined
                    : () => setEditingMessage(null)
                }
                hideFeedback={isArchived}
              />
            </ChatMessagesErrorBoundary>
          )}
        </div>
      )}

      {/* Floating "Quote" affordance on text selection inside messages.
          Portals to <body>, so placement here is just for lifecycle. */}
      {!readOnly && <SelectionQuoteButton containerRef={containerRef} />}

      <PanelFooter className="mt-auto">
        <div className="relative mx-auto w-full max-w-(--chat-max-width)">
          <AnimatePresence>
            {showScrollButton && (
              <m.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
                className="absolute -top-10 right-2 z-10 sm:right-0"
              >
                <Button
                  onClick={scrollToBottom}
                  size="icon"
                  variant="secondary"
                  className="bg-opacity-60 rounded-full shadow-lg backdrop-blur-sm"
                  aria-label={t('aria.scrollToBottom')}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </m.div>
            )}
          </AnimatePresence>
        </div>
        {readOnly ? (
          <div className="border-border bg-muted/50 flex items-center justify-center gap-2 border-t px-3 py-3">
            <Share className="text-muted-foreground size-4" />
            <span className="text-muted-foreground text-sm">
              {t('share.readOnlyBanner')}
            </span>
          </div>
        ) : isArchived ? (
          <div className="border-border bg-muted/50 flex items-center justify-center gap-2 border-t px-3 py-3">
            <Archive className="text-muted-foreground size-4" />
            <span className="text-muted-foreground text-sm">
              {t('archivedBanner')}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={isUnarchiving}
              onClick={() => {
                if (threadId) {
                  unarchiveThread({ threadId });
                }
              }}
            >
              {t('unarchive')}
            </Button>
          </div>
        ) : (
          <FileUpload.Root>
            <div className="px-3">
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
                  isImageGenAgent
                    ? activeEditingImage && currentModelSupportsEdit
                      ? t('imageEdit.placeholder')
                      : t('imageEdit.placeholderCreate')
                    : t('placeholder')
                }
                value={inputValue}
                onChange={setInputValue}
                onSendMessage={handleSendMessage}
                onStopGenerating={isGenerating ? stopGenerating : undefined}
                isLoading={isLoading}
                disabled={hasNoAgents || hasActiveApproval}
                disabledReason={
                  hasNoAgents
                    ? 'no-agents'
                    : hasActiveApproval
                      ? 'pending-approval'
                      : undefined
                }
                organizationId={organizationId}
                threadId={dataThreadId}
                attachments={attachments}
                uploadingFiles={uploadingFiles}
                uploadFiles={uploadFiles}
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
                sendBlocked={
                  isImageGenAgent &&
                  !!activeEditingImage &&
                  !currentModelSupportsEdit
                }
                sendBlockedReason={
                  isImageGenAgent &&
                  !!activeEditingImage &&
                  !currentModelSupportsEdit
                    ? t('imageEdit.modelCannotEdit')
                    : undefined
                }
                onSavePrompt={(content) =>
                  setSavePromptData({ messageId: '', content })
                }
                onOpenPromptLibrary={() => setPromptLibraryOpen(true)}
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
    </div>
  );
}
