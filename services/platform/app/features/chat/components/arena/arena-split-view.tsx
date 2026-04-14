'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  useChatLayout,
  type PendingMessage,
} from '../../context/chat-layout-context';
import {
  useDocumentWriteApprovals,
  useHumanInputRequests,
  useIntegrationApprovals,
  useLocationRequests,
  useWorkflowCreationApprovals,
  useWorkflowRunApprovals,
  useWorkflowUpdateApprovals,
} from '../../hooks/queries';
import { useMergedChatItems } from '../../hooks/use-merged-chat-items';
import type { ChatMessage } from '../../hooks/use-message-processing';
import { useMessageProcessing } from '../../hooks/use-message-processing';
import type { FileAttachment } from '../../types';
import { ChatMessages } from '../chat-messages';
import { useArenaMode } from './arena-mode-context';
import { ArenaVerdictBar } from './arena-verdict-bar';

interface ArenaSplitViewProps {
  organizationId: string;
}

/**
 * A fully independent chat column for arena mode.
 *
 * Each column manages its own message list, optimistic display, and loading
 * state. The parent only passes down the pending message content as props —
 * columns never write to shared context state.
 */
function ArenaColumn({
  label,
  threadId,
  organizationId,
  pendingContent,
  pendingAttachments,
  pendingTimestamp,
}: {
  label: string;
  threadId: string;
  organizationId: string;
  pendingContent?: string;
  pendingAttachments?: PendingMessage['attachments'];
  pendingTimestamp?: Date;
}) {
  // Message processing — independent per column
  const {
    messages: rawMessages,
    loadMore,
    canLoadMore,
    isLoadingMore,
    activeMessage,
  } = useMessageProcessing(threadId);

  // --- Local pending state (independent per column) ---
  const [showPending, setShowPending] = useState(false);
  const pendingKeyRef = useRef<number | null>(null);

  // New pending content from parent → show optimistic message
  useEffect(() => {
    if (
      pendingTimestamp &&
      pendingKeyRef.current !== pendingTimestamp.getTime()
    ) {
      pendingKeyRef.current = pendingTimestamp.getTime();
      setShowPending(true);
    }
  }, [pendingTimestamp]);

  // Real user message arrived → hide optimistic
  const userMsgCount = useMemo(
    () => rawMessages.filter((m) => m.role === 'user').length,
    [rawMessages],
  );
  const baselineRef = useRef(userMsgCount);
  useEffect(() => {
    if (showPending && userMsgCount > baselineRef.current) {
      setShowPending(false);
    }
    if (!showPending) {
      baselineRef.current = userMsgCount;
    }
  }, [userMsgCount, showPending]);

  // Build messages with optional optimistic user message
  const messages: ChatMessage[] = useMemo(() => {
    if (!showPending || !pendingContent || !pendingTimestamp)
      return rawMessages;

    const attachments: FileAttachment[] | undefined = pendingAttachments?.map(
      (a) => ({
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- PendingMessageAttachment.fileId is a Convex storage ID string
        fileId: a.fileId as Id<'_storage'>,
        fileName: a.fileName,
        fileType: a.fileType,
        fileSize: a.fileSize,
      }),
    );

    const optimistic: ChatMessage = {
      id: `pending-${pendingTimestamp.getTime()}`,
      key: `pending-${pendingTimestamp.getTime()}`,
      content: pendingContent,
      role: 'user',
      timestamp: pendingTimestamp,
      attachments:
        attachments && attachments.length > 0 ? attachments : undefined,
    };
    return [...rawMessages, optimistic];
  }, [
    rawMessages,
    showPending,
    pendingContent,
    pendingAttachments,
    pendingTimestamp,
  ]);

  // Loading state: each column subscribes to its own generationStatus
  const { data: isGenerating } = useConvexQuery(
    api.threads.queries.isThreadGenerating,
    { threadId },
  );
  const columnLoading = isGenerating ?? false;

  // Approvals
  const { approvals: integrationApprovals } = useIntegrationApprovals(
    organizationId,
    threadId,
  );
  const { approvals: workflowCreationApprovals } = useWorkflowCreationApprovals(
    organizationId,
    threadId,
  );
  const { approvals: workflowUpdateApprovals } = useWorkflowUpdateApprovals(
    organizationId,
    threadId,
  );
  const { approvals: workflowRunApprovals } = useWorkflowRunApprovals(
    organizationId,
    threadId,
  );
  const { requests: humanInputRequests } = useHumanInputRequests(
    organizationId,
    threadId,
  );
  const { requests: locationRequests } = useLocationRequests(
    organizationId,
    threadId,
  );
  const { approvals: documentWriteApprovals } = useDocumentWriteApprovals(
    organizationId,
    threadId,
  );

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

  const { data: forkInfo } = useConvexQuery(
    api.threads.queries.getThreadForkInfo,
    { threadId },
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastUserMessageRef = useRef<HTMLDivElement>(null);

  // Auto-scroll: always scroll to bottom when a new user message arrives
  const userMessageCount = mergedMessages.filter(
    (m) => m.type === 'message' && m.data.role === 'user',
  ).length;
  const prevUserCountRef = useRef(userMessageCount);
  useEffect(() => {
    if (userMessageCount > prevUserCountRef.current) {
      requestAnimationFrame(() => {
        containerRef.current?.scrollTo({
          top: containerRef.current?.scrollHeight ?? 0,
          behavior: 'smooth',
        });
      });
    }
    prevUserCountRef.current = userMessageCount;
  }, [userMessageCount]);

  // Auto-scroll: follow content growth during streaming (when near bottom)
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return undefined;

    const isAtBottom = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      return scrollHeight - scrollTop - clientHeight <= 100;
    };

    const observer = new ResizeObserver(() => {
      if (isAtBottom()) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'instant',
        });
      }
    });
    observer.observe(content);

    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-border bg-muted/50 border-b px-4 py-2">
        <span className="text-muted-foreground text-xs font-medium">
          {label}
        </span>
      </div>
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        <div ref={contentRef} className="flex flex-col p-4 sm:p-6">
          <ChatMessages
            items={mergedMessages}
            threadId={threadId}
            organizationId={organizationId}
            canLoadMore={canLoadMore}
            isLoadingMore={isLoadingMore}
            loadMore={loadMore}
            activeMessage={activeMessage}
            isLoading={columnLoading}
            lastUserMessageRef={lastUserMessageRef}
            containerRef={containerRef}
            activeApproval={activeApproval}
            forkedMessageCount={forkInfo?.forkedMessageCount ?? undefined}
            lastForkedMessageOrder={
              forkInfo?.lastForkedMessageOrder ?? undefined
            }
            forkedAt={forkInfo?.forkedAt ?? undefined}
            forkedFromShare={forkInfo?.forkedFromShare}
            hideBranchNavigator
          />
        </div>
      </div>
    </div>
  );
}

function ArenaColumnSkeleton({ label }: { label: string }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-border bg-muted/50 border-b px-4 py-2">
        <span className="text-muted-foreground text-xs font-medium">
          {label}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    </div>
  );
}

export function ArenaSplitView({ organizationId }: ArenaSplitViewProps) {
  const { t } = useT('chat');
  const { pendingMessage } = useChatLayout();
  const { arenaThreadIdA, arenaThreadIdB, modelA, modelB } = useArenaMode();

  const labelA = modelA ? `A - ${modelA}` : t('arena.modelALabel');
  const labelB = modelB ? `B - ${modelB}` : t('arena.modelBLabel');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {arenaThreadIdA ? (
          <ArenaColumn
            label={labelA}
            threadId={arenaThreadIdA}
            organizationId={organizationId}
            pendingContent={pendingMessage?.content}
            pendingAttachments={pendingMessage?.attachments}
            pendingTimestamp={pendingMessage?.timestamp}
          />
        ) : (
          <ArenaColumnSkeleton label={labelA} />
        )}
        <div className="bg-border w-px shrink-0" />
        {arenaThreadIdB ? (
          <ArenaColumn
            label={labelB}
            threadId={arenaThreadIdB}
            organizationId={organizationId}
            pendingContent={pendingMessage?.content}
            pendingAttachments={pendingMessage?.attachments}
            pendingTimestamp={pendingMessage?.timestamp}
          />
        ) : (
          <ArenaColumnSkeleton label={labelB} />
        )}
      </div>
      {arenaThreadIdA && arenaThreadIdB && (
        <ArenaVerdictBar
          threadIdA={arenaThreadIdA}
          threadIdB={arenaThreadIdB}
          organizationId={organizationId}
        />
      )}
    </div>
  );
}
