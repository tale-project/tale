'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useChatLayout } from '@/app/features/chat/context/chat-layout-context';
import { useUnifiedChatWithAgent } from '@/app/features/chat/hooks/mutations';
import { useResolvedHumanInputRequests } from '@/app/features/chat/hooks/queries';
import { useConvexFileUpload } from '@/app/features/chat/hooks/use-convex-file-upload';
import { useFileIndexingStatus } from '@/app/features/chat/hooks/use-file-indexing-status';
import { useFileTranscriptionStatus } from '@/app/features/chat/hooks/use-file-transcription-status';
import { useMergedChatItems } from '@/app/features/chat/hooks/use-merged-chat-items';
import { useMessageProcessing } from '@/app/features/chat/hooks/use-message-processing';
import { usePendingMessages } from '@/app/features/chat/hooks/use-pending-messages';
import { useThreadApprovals } from '@/app/features/chat/hooks/use-thread-approvals';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';

// Module-level guard to prevent duplicate sends (survives component remounts;
// same mechanism as the workflow assistant's panel).
const recentSends = new Map<string, number>();
const DUPLICATE_WINDOW_MS = 5000;
const SAFETY_TIMEOUT_MS = 60_000;

function canSendMessage(content: string, threadId: string | null): boolean {
  const key = `${threadId || 'new'}:${content.trim().toLowerCase()}`;
  const lastSent = recentSends.get(key);
  const now = Date.now();

  if (lastSent && now - lastSent < DUPLICATE_WINDOW_MS) {
    console.warn('[EmbeddedChat] Blocked duplicate send:', key);
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

export interface UseEmbeddedChatOptions {
  organizationId: string;
  /** The agent answering every turn — pinned, never routed. */
  agentSlug: string;
  /**
   * A pre-resolved thread (e.g. a host's read-only lookup of the shared
   * per-subject thread). `null`/`undefined` means "no thread known yet" —
   * the first send acquires one via `resolveThread`.
   */
  threadId?: string | null;
  /**
   * Lazily acquires the thread on the FIRST send (mirrors the workflow
   * assistant's lazy thread creation). Must be idempotent — concurrent
   * hosts may race it — and referentially stable (`useCallback`), since it
   * anchors the send handler.
   */
  resolveThread: () => Promise<string>;
  /** Extra key/value context injected into every turn's prompt. */
  additionalContext?: Record<string, string>;
  /** Toast copy when a send fails (host resolves i18n). */
  errorMessageText: string;
  /** Message substituted when the user sends attachments with no text. */
  analyzeAttachmentsText: string;
}

/**
 * Data layer for an embedded chat panel — the generalization of
 * `use-assistant-chat` (workflows): the send path pins a caller-supplied
 * `agentSlug` and rides caller-supplied `additionalContext`, and the thread is
 * acquired lazily through `resolveThread` instead of a hardcoded
 * `createChatThread`. Message RENDERING is the main-chat pipeline, 1:1 —
 * `useMessageProcessing` (streaming UIMessages with reasoning/tool parts) →
 * `usePendingMessages` (optimistic bubble via the panel's own
 * ChatLayoutProvider) → `useMergedChatItems` (approval cards spliced into the
 * flow) — so the panel renders through the same `ChatMessages`/`MessageBubble`
 * stack as the chat page.
 */
export function useEmbeddedChat({
  organizationId,
  agentSlug,
  threadId: knownThreadId,
  resolveThread,
  additionalContext,
  errorMessageText,
  analyzeAttachmentsText,
}: UseEmbeddedChatOptions) {
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
  // Thread acquired by this hook's own first send. A ref shadows the state so
  // a second send that lands before the re-render still sees the acquired id
  // (thread acquisition stays exactly-once per mount).
  const [acquiredThreadId, setAcquiredThreadId] = useState<string | null>(null);
  const acquiredThreadIdRef = useRef<string | null>(null);
  const isSendingRef = useRef(false);

  const { setPendingMessage } = useChatLayout();

  const { mutateAsync: chatWithAgent } = useUnifiedChatWithAgent();

  // The acquired id wins over a late-arriving host id — they name the same
  // thread anyway when `resolveThread` is idempotent (the app-thread backend
  // serializes get-or-create per subject).
  const threadId = acquiredThreadId ?? knownThreadId ?? null;

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
  });

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
      const existingThreadId =
        acquiredThreadIdRef.current ?? knownThreadId ?? null;

      if (!canSendMessage(messageContent, existingThreadId)) {
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
        threadId: existingThreadId ?? 'pending',
        attachments: mutationAttachments,
        timestamp: pendingTimestamp,
        lastMessageKey: existingThreadId
          ? lastMessageKeyRef.current
          : undefined,
      });

      setInputValue('');
      setIsPending(true);

      try {
        let currentThreadId = existingThreadId;
        if (!currentThreadId) {
          currentThreadId = await resolveThread();
          acquiredThreadIdRef.current = currentThreadId;
          setAcquiredThreadId(currentThreadId);
          // Re-key the optimistic bubble onto the real thread so it stays
          // visible (and clears correctly) once the subscription attaches.
          setPendingMessage({
            content: messageContent,
            threadId: currentThreadId,
            attachments: mutationAttachments,
            timestamp: pendingTimestamp,
          });
        }

        await chatWithAgent({
          agentSlug,
          threadId: currentThreadId,
          organizationId,
          message: messageContent || analyzeAttachmentsText,
          attachments: mutationAttachments,
          additionalContext,
        });
      } catch (error) {
        console.error('[EmbeddedChat] send failed:', error);
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
      knownThreadId,
      clearAttachments,
      setPendingMessage,
      resolveThread,
      chatWithAgent,
      agentSlug,
      additionalContext,
      analyzeAttachmentsText,
      errorMessageText,
    ],
  );

  return {
    threadId,
    items,
    activeApproval,
    activeApprovalInline,
    loadMore,
    canLoadMore,
    isLoadingMore,
    isLoading,
    isSendPending: isPending,
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
