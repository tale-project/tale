'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ThinkingAnchor } from '@/app/features/chat/components/thought-timeline/use-thinking-timer';
import { useChatLayout } from '@/app/features/chat/context/chat-layout-context';
import {
  useCreateThread,
  useUnifiedChatWithAgent,
} from '@/app/features/chat/hooks/mutations';
import { useResolvedHumanInputRequests } from '@/app/features/chat/hooks/queries';
import { useConvexFileUpload } from '@/app/features/chat/hooks/use-convex-file-upload';
import { useFileIndexingStatus } from '@/app/features/chat/hooks/use-file-indexing-status';
import { useFileTranscriptionStatus } from '@/app/features/chat/hooks/use-file-transcription-status';
import { useMergedChatItems } from '@/app/features/chat/hooks/use-merged-chat-items';
import { useMessageProcessing } from '@/app/features/chat/hooks/use-message-processing';
import { usePendingMessages } from '@/app/features/chat/hooks/use-pending-messages';
import { useThreadApprovals } from '@/app/features/chat/hooks/use-thread-approvals';
import {
  useClockOffset,
  useReportServerNow,
} from '@/app/hooks/use-clock-offset';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';

import { useReadWorkflow } from './file-queries';

// Module-level guard to prevent duplicate sends (survives component remounts)
const recentSends = new Map<string, number>();
const DUPLICATE_WINDOW_MS = 5000;
const SAFETY_TIMEOUT_MS = 60_000;

function canSendMessage(content: string, threadId: string | null): boolean {
  const key = `${threadId || 'new'}:${content.trim().toLowerCase()}`;
  const lastSent = recentSends.get(key);
  const now = Date.now();

  if (lastSent && now - lastSent < DUPLICATE_WINDOW_MS) {
    console.warn('[AutomationAssistant] Blocked duplicate send:', key);
    return false;
  }

  recentSends.set(key, now);
  for (const [k, time] of recentSends) {
    if (now - time > DUPLICATE_WINDOW_MS) {
      recentSends.delete(k);
    }
  }
  return true;
}

interface UseAssistantChatOptions {
  workflowSlug?: string;
  workflowName?: string;
  organizationId: string;
  errorMessageText: string;
  analyzeAttachmentsText: string;
}

/**
 * Data layer for the workflow-editor AI panel. Message rendering is the MAIN
 * CHAT pipeline, 1:1 — `useMessageProcessing` (streaming UIMessages with
 * reasoning/tool parts for the thought timeline) → `usePendingMessages`
 * (optimistic bubble via the panel's own ChatLayoutProvider) →
 * `useMergedChatItems` (approval cards spliced into the flow) — so the panel
 * renders through the same `ChatMessages`/`MessageBubble` stack as the chat
 * page. Only the send path differs: the agent is pinned to
 * `workflow-assistant` and each turn carries the edited workflow as context.
 */
export function useAssistantChat({
  workflowSlug,
  workflowName,
  organizationId,
  errorMessageText,
  analyzeAttachmentsText,
}: UseAssistantChatOptions) {
  const {
    attachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    clearAttachments,
  } = useConvexFileUpload({ organizationId });
  const { isIndexing, statusMap: indexingStatuses } = useFileIndexingStatus(
    attachments,
    organizationId,
  );
  const {
    isTranscribing,
    isQueryLoading: isTranscriptionQueryLoading,
    statusMap: transcriptionStatuses,
  } = useFileTranscriptionStatus(attachments, organizationId);
  const [inputValue, setInputValue] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const isSendingRef = useRef(false);

  const { pendingMessage, setPendingMessage } = useChatLayout();

  const assistantAgentSlug = 'workflow-assistant';

  const { mutateAsync: chatWithAgent } = useUnifiedChatWithAgent();
  const { mutateAsync: createChatThread } = useCreateThread();

  const { data: readResult } = useReadWorkflow(organizationId, workflowSlug);
  const workflow = useMemo(() => {
    if (!readResult || !readResult.ok) return null;
    return {
      name: readResult.config.name,
      metadata: readResult.config.metadata,
    };
  }, [readResult]);

  // ---- Main-chat message pipeline ----------------------------------------
  const {
    messages: rawMessages,
    loadMore,
    canLoadMore,
    isLoadingMore,
  } = useMessageProcessing(threadId ?? undefined);

  // Optimistic user bubble (set on send below), merged exactly like the chat
  // page does it.
  const messages = usePendingMessages({
    threadId: threadId ?? undefined,
    realMessages: rawMessages,
    isSendPending: isPending,
  });

  const { data: threadMeta } = useConvexQuery(
    api.threads.queries.getThreadMeta,
    threadId && organizationId ? { threadId, organizationId } : 'skip',
  );
  const generationStartMs = threadMeta?.generationStartTime ?? null;

  // Thinking-timer anchor (same clock-safe contract as the main chat): prefer
  // the immutable client send time so the live timer never swaps client→server
  // mid-turn; the server start (converted to the client frame) is the reload
  // fallback. Feeds the offset authority from the serverNow this query carries.
  useReportServerNow(threadMeta?.serverNow);
  const { toClientEpoch } = useClockOffset();
  const clientTurnStartRef = useRef<number | null>(null);
  const clientTurnStartMs =
    pendingMessage && !pendingMessage.editedMessageId
      ? pendingMessage.timestamp.getTime()
      : isPending
        ? clientTurnStartRef.current
        : null;
  clientTurnStartRef.current = clientTurnStartMs;
  const serverStartClientMs =
    generationStartMs === null ? null : toClientEpoch(generationStartMs);
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

  const approvals = useThreadApprovals(organizationId, threadId ?? undefined);
  const { requests: resolvedHumanInputRequests } =
    useResolvedHumanInputRequests(organizationId, threadId ?? undefined);

  const {
    messages: items,
    activeApproval,
    activeApprovalInline,
  } = useMergedChatItems({
    messages,
    integrationApprovals: approvals.integrationApprovals,
    workflowCreationApprovals: approvals.workflowCreationApprovals,
    workflowUpdateApprovals: approvals.workflowUpdateApprovals,
    workflowRunApprovals: approvals.workflowRunApprovals,
    humanInputRequests: approvals.humanInputRequests,
    resolvedHumanInputRequests,
    locationRequests: approvals.locationRequests,
    documentWriteApprovals: approvals.documentWriteApprovals,
  });

  // Always-current tail key for the optimistic bubble's clear baseline.
  const lastMessageKeyRef = useRef<string | undefined>(undefined);
  lastMessageKeyRef.current = rawMessages[rawMessages.length - 1]?.key;

  // Server-side loading state: is the agent currently generating?
  const { data: isGenerating } = useConvexQuery(
    api.threads.queries.isThreadGenerating,
    threadId && organizationId ? { threadId, organizationId } : 'skip',
  );

  // Dual-layer loading: isPending (optimistic) + isGenerating (server reactive)
  const isLoading = isPending || (isGenerating ?? false);

  // Handoff: clear isPending once isGenerating takes over
  useEffect(() => {
    if (isPending && isGenerating) {
      setIsPending(false);
    }
  }, [isPending, isGenerating]);

  // Safety timeout: clear isPending after max lifetime
  useEffect(() => {
    if (!isPending) return undefined;
    const timeout = setTimeout(() => setIsPending(false), SAFETY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [isPending]);

  // Load threadId from workflow metadata when workflow is loaded
  useEffect(() => {
    const metaThreadId = workflow?.metadata?.threadId;
    if (metaThreadId && typeof metaThreadId === 'string' && !threadId) {
      setThreadId(metaThreadId);
    }
  }, [workflow, threadId, workflowSlug]);

  // The chat composer (`ChatInput`) clears the attachment strip itself and
  // hands the snapshot over; calls without arguments fall back to reading
  // the hook's own state (legacy path).
  const handleSendMessage = useCallback(
    async (
      messageOverride?: string,
      attachmentsOverride?: ReturnType<typeof clearAttachments>,
    ) => {
      if (isSendingRef.current) return;
      const rawMessage = messageOverride ?? inputValue;
      const hasAttachments =
        (attachmentsOverride?.length ?? attachments.length) > 0;
      if (
        (!rawMessage.trim() && !hasAttachments) ||
        isLoading ||
        !organizationId ||
        isIndexing ||
        isTranscribing ||
        isTranscriptionQueryLoading
      )
        return;

      const messageContent = rawMessage.trim();

      if (!canSendMessage(messageContent, threadId)) {
        return;
      }

      isSendingRef.current = true;

      const clearedAttachments = attachmentsOverride ?? clearAttachments();
      const attachmentsToSend =
        clearedAttachments.length > 0 ? clearedAttachments : undefined;

      const mutationAttachments = attachmentsToSend
        ? attachmentsToSend.map((a) => ({
            fileId: a.fileId,
            fileName: a.fileName,
            fileType: a.fileType,
            fileSize: a.fileSize,
          }))
        : undefined;

      // Optimistic bubble through the shared pending-message channel (the
      // panel mounts its own ChatLayoutProvider, so this never collides with
      // the chat page). `lastMessageKey` is the clear baseline for existing
      // threads; a brand-new thread clears on its first real message.
      const pendingTimestamp = new Date();
      setPendingMessage({
        content: messageContent,
        threadId: threadId ?? 'pending',
        attachments: mutationAttachments,
        timestamp: pendingTimestamp,
        lastMessageKey: threadId ? lastMessageKeyRef.current : undefined,
      });

      setInputValue('');
      setIsPending(true);

      try {
        let currentThreadId = threadId;
        if (!currentThreadId) {
          const title =
            messageContent.length > 50
              ? `${messageContent.slice(0, 50)}...`
              : messageContent;

          currentThreadId = await createChatThread({
            organizationId,
            title,
            chatType: 'workflow_assistant',
          });
          setThreadId(currentThreadId);
          // Re-key the optimistic bubble onto the real thread so it stays
          // visible (and clears correctly) once the subscription attaches.
          setPendingMessage({
            content: messageContent,
            threadId: currentThreadId ?? 'pending',
            attachments: mutationAttachments,
            timestamp: pendingTimestamp,
          });
        }

        if (!currentThreadId) return;

        await chatWithAgent({
          agentSlug: assistantAgentSlug,
          threadId: currentThreadId,
          organizationId,
          message: messageContent || analyzeAttachmentsText,
          attachments: mutationAttachments,
          additionalContext: workflowSlug
            ? {
                target_workflow_id: workflowSlug,
                target_workflow_name: workflowName ?? workflow?.name ?? '',
              }
            : undefined,
        });
      } catch (error) {
        console.error('Error calling workflow assistant:', error);
        setIsPending(false);
        setPendingMessage(null);
        toast({ title: errorMessageText, variant: 'destructive' });
      } finally {
        isSendingRef.current = false;
      }
    },
    [
      inputValue,
      attachments.length,
      isLoading,
      organizationId,
      isIndexing,
      isTranscribing,
      isTranscriptionQueryLoading,
      threadId,
      clearAttachments,
      setPendingMessage,
      createChatThread,
      chatWithAgent,
      analyzeAttachmentsText,
      workflowSlug,
      workflowName,
      workflow?.name,
      errorMessageText,
    ],
  );

  return {
    workflow,
    threadId,
    items,
    activeApproval,
    activeApprovalInline,
    loadMore,
    canLoadMore,
    isLoadingMore,
    isLoading,
    isSendPending: isPending,
    thinkingAnchor,
    inputValue,
    setInputValue,
    attachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    clearAttachments,
    isIndexing,
    indexingStatuses,
    isTranscribing: isTranscribing || isTranscriptionQueryLoading,
    transcriptionStatuses,
    handleSendMessage,
  };
}
