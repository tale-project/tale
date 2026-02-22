import { useUIMessages } from '@convex-dev/agent/react';
import { useMemo } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type { WorkflowCreationMetadata } from '@/convex/approvals/types';
import type { HumanInputRequestMetadata } from '@/lib/shared/schemas/approvals';
import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useApprovals } from '@/app/features/approvals/hooks/queries';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import { MAX_BATCH_FILE_IDS } from '@/lib/shared/file-types';

export interface Thread {
  _id: string;
  _creationTime: number;
  title?: string;
  status: 'active' | 'archived';
  userId?: string;
}

const THREADS_PAGE_SIZE = 20;

export function useThreads({ skip = false } = {}) {
  const { isAuthenticated } = useConvexAuth();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- paginationOpts is optional for defensive handling of Convex reconnection edge cases; usePaginatedQuery always provides it at runtime
  const { results, status, loadMore, isLoading } = useCachedPaginatedQuery(
    api.threads.queries.listThreads as Parameters<
      typeof useCachedPaginatedQuery
    >[0],
    isAuthenticated && !skip ? {} : 'skip',
    { initialNumItems: THREADS_PAGE_SIZE },
  );

  const threads = useMemo(
    () => results?.slice().sort((a, b) => b._creationTime - a._creationTime),
    [results],
  );

  return {
    threads,
    isLoading,
    canLoadMore: status === 'CanLoadMore',
    isLoadingMore: status === 'LoadingMore',
    loadMore: () => loadMore(THREADS_PAGE_SIZE),
  };
}

export type CustomAgent = ConvexItemOf<
  typeof api.custom_agents.queries.listCustomAgents
>;

export function useChatAgents(organizationId: string) {
  const { selectedTeamId } = useTeamFilter();
  const { data } = useConvexQuery(api.custom_agents.queries.listCustomAgents, {
    organizationId,
    filterPublished: true,
  });

  const agents = useMemo(() => {
    if (!data) return undefined;
    if (!selectedTeamId) return data;
    return data.filter((agent) => {
      // Org-wide agents (no teamId) are always visible, matching backend hasTeamAccess logic
      if (!agent.teamId) return true;
      return (
        agent.teamId === selectedTeamId ||
        (agent.sharedWithTeamIds?.includes(selectedTeamId) ?? false)
      );
    });
  }, [data, selectedTeamId]);

  return {
    agents,
  };
}

export function useFileUrl(fileId: Id<'_storage'> | undefined, skip = false) {
  return useConvexQuery(
    api.files.queries.getFileUrl,
    !fileId || skip ? 'skip' : { fileId },
  );
}

export function useFileUrls(fileIds: Id<'_storage'>[], skip = false) {
  return useConvexQuery(
    api.files.queries.getFileUrls,
    skip || fileIds.length === 0
      ? 'skip'
      : { fileIds: fileIds.slice(0, MAX_BATCH_FILE_IDS) },
  );
}

export function useThreadMessages(threadId: string | null) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex agent SDK useUIMessages expects UIMessagesQuery which doesn't match generated API types
  const query = api.threads.queries
    .getThreadMessagesStreaming as unknown as Parameters<
    typeof useUIMessages
  >[0];
  const { results } = useUIMessages(query, threadId ? { threadId } : 'skip', {
    initialNumItems: 30,
    // @ts-expect-error -- Convex agent SDK StreamQuery conditional type doesn't resolve correctly with generated API types; stream: true is valid at runtime
    stream: true,
  });

  return results;
}

export interface HumanInputRequest {
  _id: Id<'approvals'>;
  status: 'pending' | 'approved' | 'rejected';
  metadata: HumanInputRequestMetadata;
  _creationTime: number;
  messageId?: string;
}

export function useHumanInputRequests(
  organizationId: string,
  threadId: string | undefined,
) {
  const { approvals, isLoading } = useApprovals(organizationId);

  const humanInputRequests = useMemo((): HumanInputRequest[] => {
    if (!approvals || !threadId) return [];
    return approvals
      .filter(
        (a) =>
          a.threadId === threadId &&
          a.resourceType === 'human_input_request' &&
          a.metadata !== undefined,
      )
      .map((a) => ({
        _id: toId<'approvals'>(a._id),
        status: a.status,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
        metadata: a.metadata as unknown as HumanInputRequestMetadata,
        _creationTime: a._creationTime,
        messageId: a.messageId,
      }));
  }, [approvals, threadId]);

  return {
    requests: humanInputRequests,
    isLoading,
  };
}

export interface IntegrationOperationMetadata {
  integrationId: string;
  integrationName: string;
  integrationType: 'sql' | 'rest_api';
  operationName: string;
  operationTitle: string;
  operationType: 'read' | 'write';
  parameters: Record<string, unknown>;
  previewData?: unknown[];
  estimatedImpact?: string;
  requestedAt: number;
  executedAt?: number;
  executionResult?: unknown;
}

export interface IntegrationApproval {
  _id: Id<'approvals'>;
  status: 'pending' | 'approved' | 'rejected';
  metadata: IntegrationOperationMetadata;
  executedAt?: number;
  executionError?: string;
  _creationTime: number;
  messageId?: string;
}

export function useIntegrationApprovals(
  organizationId: string,
  threadId: string | undefined,
) {
  const { approvals, isLoading } = useApprovals(organizationId);

  const integrationApprovals = useMemo((): IntegrationApproval[] => {
    if (!approvals || !threadId) return [];
    return approvals
      .filter(
        (a) =>
          a.threadId === threadId &&
          a.resourceType === 'integration_operation' &&
          a.metadata !== undefined,
      )
      .map((a) => ({
        _id: toId<'approvals'>(a._id),
        status: a.status,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
        metadata: a.metadata as unknown as IntegrationOperationMetadata,
        executedAt: a.executedAt,
        executionError: a.executionError,
        _creationTime: a._creationTime,
        messageId: a.messageId,
      }));
  }, [approvals, threadId]);

  return {
    approvals: integrationApprovals,
    isLoading,
  };
}

export interface WorkflowCreationApproval {
  _id: Id<'approvals'>;
  status: 'pending' | 'approved' | 'rejected';
  metadata: WorkflowCreationMetadata;
  executedAt?: number;
  executionError?: string;
  _creationTime: number;
  messageId?: string;
}

export function useWorkflowCreationApprovals(
  organizationId: string,
  threadId: string | undefined,
) {
  const { approvals, isLoading } = useApprovals(organizationId);

  const workflowCreationApprovals = useMemo((): WorkflowCreationApproval[] => {
    if (!approvals || !threadId) return [];
    return approvals
      .filter(
        (a) =>
          a.threadId === threadId &&
          a.resourceType === 'workflow_creation' &&
          a.metadata !== undefined,
      )
      .map((a) => ({
        _id: toId<'approvals'>(a._id),
        status: a.status,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
        metadata: a.metadata as unknown as WorkflowCreationMetadata,
        executedAt: a.executedAt,
        executionError: a.executionError,
        _creationTime: a._creationTime,
        messageId: a.messageId,
      }));
  }, [approvals, threadId]);

  return {
    approvals: workflowCreationApprovals,
    isLoading,
  };
}

export interface SubAgentUsage {
  toolName: string;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  input?: string;
  output?: string;
}

export interface ContextStats {
  totalTokens: number;
  messageCount: number;
  approvalCount: number;
  hasRag: boolean;
}

export interface MessageMetadata {
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  reasoning?: string;
  durationMs?: number;
  timeToFirstTokenMs?: number;
  subAgentUsage?: SubAgentUsage[];
  contextWindow?: string;
  contextStats?: ContextStats;
}

export function useMessageMetadata(messageId: string | null) {
  const { data: metadata, isLoading } = useConvexQuery(
    api.message_metadata.queries.getMessageMetadata,
    messageId ? { messageId } : 'skip',
  );

  return {
    metadata: metadata
      ? {
          model: metadata.model,
          provider: metadata.provider,
          inputTokens: metadata.inputTokens,
          outputTokens: metadata.outputTokens,
          totalTokens: metadata.totalTokens,
          reasoningTokens: metadata.reasoningTokens,
          cachedInputTokens: metadata.cachedInputTokens,
          reasoning: metadata.reasoning,
          durationMs: metadata.durationMs,
          timeToFirstTokenMs: metadata.timeToFirstTokenMs,
          subAgentUsage: metadata.subAgentUsage,
          contextWindow: metadata.contextWindow,
          contextStats: metadata.contextStats,
        }
      : undefined,
    isLoading,
  };
}
