'use client';

import { useRef } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

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
import { useMessageProcessing } from '../../hooks/use-message-processing';
import { usePendingMessages } from '../../hooks/use-pending-messages';
import { ChatMessages } from '../chat-messages';
import { useArenaMode } from './arena-mode-context';
import { ArenaVerdictBar } from './arena-verdict-bar';

interface ArenaSplitViewProps {
  organizationId: string;
}

function ArenaColumn({
  label,
  threadId,
  organizationId,
}: {
  label: string;
  threadId: string | null;
  organizationId: string;
}) {
  const resolvedThreadId = threadId ?? undefined;

  // Same hooks as ChatInterface — full feature parity
  const {
    messages: rawMessages,
    loadMore,
    canLoadMore,
    isLoadingMore,
    activeMessage,
  } = useMessageProcessing(resolvedThreadId);

  const messages = usePendingMessages({
    threadId: resolvedThreadId,
    realMessages: rawMessages,
  });

  // Per-column loading: check if THIS thread is generating
  const { data: isGenerating } = useConvexQuery(
    api.threads.queries.isThreadGenerating,
    resolvedThreadId ? { threadId: resolvedThreadId } : 'skip',
  );
  const columnLoading = isGenerating ?? false;

  // Approvals
  const { approvals: integrationApprovals } = useIntegrationApprovals(
    organizationId,
    resolvedThreadId,
  );
  const { approvals: workflowCreationApprovals } = useWorkflowCreationApprovals(
    organizationId,
    resolvedThreadId,
  );
  const { approvals: workflowUpdateApprovals } = useWorkflowUpdateApprovals(
    organizationId,
    resolvedThreadId,
  );
  const { approvals: workflowRunApprovals } = useWorkflowRunApprovals(
    organizationId,
    resolvedThreadId,
  );
  const { requests: humanInputRequests } = useHumanInputRequests(
    organizationId,
    resolvedThreadId,
  );
  const { requests: locationRequests } = useLocationRequests(
    organizationId,
    resolvedThreadId,
  );
  const { approvals: documentWriteApprovals } = useDocumentWriteApprovals(
    organizationId,
    resolvedThreadId,
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
    resolvedThreadId ? { threadId: resolvedThreadId } : 'skip',
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const lastUserMessageRef = useRef<HTMLDivElement>(null);

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
        <div className="flex flex-col p-4 sm:p-6">
          <ChatMessages
            items={mergedMessages}
            threadId={resolvedThreadId}
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
            forkedFromShare={forkInfo?.forkedFromShare}
            hideBranchNavigator
          />
        </div>
      </div>
    </div>
  );
}

export function ArenaSplitView({ organizationId }: ArenaSplitViewProps) {
  const { t } = useT('chat');
  const { arenaThreadIdA, arenaThreadIdB } = useArenaMode();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ArenaColumn
          label={t('arena.modelALabel')}
          threadId={arenaThreadIdA}
          organizationId={organizationId}
        />
        <div className="bg-border w-px shrink-0" />
        <ArenaColumn
          label={t('arena.modelBLabel')}
          threadId={arenaThreadIdB}
          organizationId={organizationId}
        />
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
