import { useUIMessages } from '@convex-dev/agent/react';
import { useMemo } from 'react';

import { useListAgents } from '@/app/features/agents/hooks/queries';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type {
  WorkflowCreationMetadata,
  WorkflowRunMetadata,
  WorkflowUpdateMetadata,
} from '@/convex/approvals/types';
import {
  normalizeDocumentWriteMetadata,
  type DocumentWriteMetadata,
} from '@/convex/approvals/types';
import { toId } from '@/convex/lib/type_cast_helpers';
import { MAX_BATCH_FILE_IDS } from '@/lib/shared/file-types';
import type {
  HumanInputRequestMetadata,
  LocationRequestMetadata,
} from '@/lib/shared/schemas/approvals';
import { isRecord } from '@/lib/utils/type-guards';

export interface Thread {
  _id: string;
  _creationTime: number;
  title?: string;
  status: 'active' | 'archived' | 'deleted';
  userId?: string;
  generationStatus?: 'generating' | 'idle';
  teamId?: string;
  isShared?: boolean;
}

const THREADS_PAGE_SIZE = 20;

export function useThreads({
  skip = false,
  teamId,
  organizationId,
}: {
  skip?: boolean;
  teamId?: string | null;
  organizationId?: string | null;
} = {}) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- paginationOpts is optional to handle Convex reconnection replays; usePaginatedQuery always provides it at runtime
  const listThreadsQuery = api.threads.queries
    .listThreads as unknown as Parameters<typeof useCachedPaginatedQuery>[0];
  const queryArgs = skip
    ? ('skip' as const)
    : {
        ...(teamId ? { teamId } : {}),
        ...(organizationId ? { organizationId } : {}),
      };
  const { results, status, loadMore, isLoading } = useCachedPaginatedQuery(
    listThreadsQuery,
    queryArgs,
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

export function useArchivedThreads({
  skip = false,
  teamId,
  organizationId,
}: {
  skip?: boolean;
  teamId?: string | null;
  organizationId?: string | null;
} = {}) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- paginationOpts is optional to handle Convex reconnection replays; usePaginatedQuery always provides it at runtime
  const listArchivedThreadsQuery = api.threads.queries
    .listArchivedThreads as unknown as Parameters<
    typeof useCachedPaginatedQuery
  >[0];
  const queryArgs = skip
    ? ('skip' as const)
    : {
        ...(teamId ? { teamId } : {}),
        ...(organizationId ? { organizationId } : {}),
      };
  const { results, status, loadMore, isLoading } = useCachedPaginatedQuery(
    listArchivedThreadsQuery,
    queryArgs,
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

export function useThreadStatus(threadId: string | undefined) {
  const { data } = useConvexQuery(
    api.threads.queries.getThreadStatus,
    threadId ? { threadId } : 'skip',
  );
  return data ?? null;
}

export interface ComposerModeMeta {
  label: string;
  icon?: string;
  tooltip?: string;
  order?: number;
}

export interface ChatAgent {
  name: string;
  displayName: string;
  description?: string;
  visibleInChat?: boolean;
  /**
   * Root behavior. Omitted = 'chat'. 'image-generation' flips the composer
   * into direct image-gen mode (model picker filters on image tag, EditingBanner
   * activates when the thread has images).
   */
  primaryBehavior?: 'chat' | 'image-generation';
  supportedModels?: string[];
  toolNames?: string[];
  roleRestriction?: string;
  conversationStarters?: string[];
  composerMode?: ComposerModeMeta;
  i18n?: Record<
    string,
    {
      displayName?: string;
      description?: string;
      conversationStarters?: string[];
    }
  >;
}

function isComposerModeMeta(value: unknown): value is ComposerModeMeta {
  if (!isRecord(value)) return false;
  const label = value.label;
  return typeof label === 'string' && label.length > 0;
}

export function useChatAgents(_organizationId: string) {
  const { agents: rawAgents, isLoading } = useListAgents('default');

  const agents = useMemo(() => {
    if (!rawAgents) return undefined;
    const chatAgents: ChatAgent[] = [];
    for (const a of rawAgents) {
      if (
        a &&
        'displayName' in a &&
        typeof a.displayName === 'string' &&
        a.visibleInChat === true
      ) {
        chatAgents.push({
          name: a.name,
          displayName: a.displayName,
          description: a.description,
          visibleInChat: a.visibleInChat,
          primaryBehavior:
            'primaryBehavior' in a &&
            (a.primaryBehavior === 'chat' ||
              a.primaryBehavior === 'image-generation')
              ? a.primaryBehavior
              : undefined,
          supportedModels: a.supportedModels,
          conversationStarters: a.conversationStarters,
          composerMode:
            'composerMode' in a && isComposerModeMeta(a.composerMode)
              ? a.composerMode
              : undefined,
          i18n: a.i18n,
        });
      }
    }
    return chatAgents;
  }, [rawAgents]);

  return {
    agents,
    isLoading,
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
    initialNumItems: 100,
    // @ts-expect-error -- Convex agent SDK StreamQuery conditional type doesn't resolve correctly with generated API types; stream: true is valid at runtime
    stream: true,
  });

  return results;
}

export function useActiveApprovals(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.approvals.queries.listActiveApprovalsByOrganization,
    { organizationId },
  );

  return {
    approvals: data ?? [],
    isLoading,
  };
}

export interface HumanInputRequest {
  _id: Id<'approvals'>;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
  metadata: HumanInputRequestMetadata;
  _creationTime: number;
  messageId?: string;
  wfExecutionId?: Id<'wfExecutions'>;
}

export function useHumanInputRequests(
  organizationId: string,
  threadId: string | undefined,
) {
  const { approvals, isLoading } = useActiveApprovals(organizationId);

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
        wfExecutionId: a.wfExecutionId
          ? toId<'wfExecutions'>(a.wfExecutionId)
          : undefined,
      }));
  }, [approvals, threadId]);

  return {
    requests: humanInputRequests,
    isLoading,
  };
}

export interface LocationRequest {
  _id: Id<'approvals'>;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
  metadata: LocationRequestMetadata;
  _creationTime: number;
  messageId?: string;
  wfExecutionId?: Id<'wfExecutions'>;
}

export function useLocationRequests(
  organizationId: string,
  threadId: string | undefined,
) {
  const { approvals, isLoading } = useActiveApprovals(organizationId);

  const locationRequests = useMemo((): LocationRequest[] => {
    if (!approvals || !threadId) return [];
    return approvals
      .filter(
        (a) =>
          a.threadId === threadId &&
          a.resourceType === 'location_request' &&
          a.metadata !== undefined,
      )
      .map((a) => ({
        _id: toId<'approvals'>(a._id),
        status: a.status,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
        metadata: a.metadata as unknown as LocationRequestMetadata,
        _creationTime: a._creationTime,
        messageId: a.messageId,
        wfExecutionId: a.wfExecutionId
          ? toId<'wfExecutions'>(a.wfExecutionId)
          : undefined,
      }));
  }, [approvals, threadId]);

  return {
    requests: locationRequests,
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
  status: 'pending' | 'executing' | 'completed' | 'rejected';
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
  const { approvals, isLoading } = useActiveApprovals(organizationId);

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
  status: 'pending' | 'executing' | 'completed' | 'rejected';
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
  const { approvals, isLoading } = useActiveApprovals(organizationId);

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

export interface WorkflowRunApproval {
  _id: Id<'approvals'>;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
  metadata: WorkflowRunMetadata;
  executedAt?: number;
  executionError?: string;
  _creationTime: number;
  messageId?: string;
}

export function useWorkflowRunApprovals(
  organizationId: string,
  threadId: string | undefined,
) {
  const { approvals, isLoading } = useActiveApprovals(organizationId);

  const workflowRunApprovals = useMemo((): WorkflowRunApproval[] => {
    if (!approvals || !threadId) return [];
    return approvals
      .filter(
        (a) =>
          a.threadId === threadId &&
          a.resourceType === 'workflow_run' &&
          a.metadata !== undefined,
      )
      .map((a) => ({
        _id: toId<'approvals'>(a._id),
        status: a.status,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
        metadata: a.metadata as unknown as WorkflowRunMetadata,
        executedAt: a.executedAt,
        executionError: a.executionError,
        _creationTime: a._creationTime,
        messageId: a.messageId,
      }));
  }, [approvals, threadId]);

  return {
    approvals: workflowRunApprovals,
    isLoading,
  };
}

export interface WorkflowUpdateApproval {
  _id: Id<'approvals'>;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
  metadata: WorkflowUpdateMetadata;
  executedAt?: number;
  executionError?: string;
  _creationTime: number;
  messageId?: string;
}

export function useWorkflowUpdateApprovals(
  organizationId: string,
  threadId: string | undefined,
) {
  const { approvals, isLoading } = useActiveApprovals(organizationId);

  const workflowUpdateApprovals = useMemo((): WorkflowUpdateApproval[] => {
    if (!approvals || !threadId) return [];
    return approvals
      .filter(
        (a) =>
          a.threadId === threadId &&
          a.resourceType === 'workflow_update' &&
          a.metadata !== undefined,
      )
      .map((a) => ({
        _id: toId<'approvals'>(a._id),
        status: a.status,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
        metadata: a.metadata as unknown as WorkflowUpdateMetadata,
        executedAt: a.executedAt,
        executionError: a.executionError,
        _creationTime: a._creationTime,
        messageId: a.messageId,
      }));
  }, [approvals, threadId]);

  return {
    approvals: workflowUpdateApprovals,
    isLoading,
  };
}

export interface DocumentWriteApproval {
  _id: Id<'approvals'>;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
  metadata: DocumentWriteMetadata;
  executedAt?: number;
  executionError?: string;
  _creationTime: number;
  messageId?: string;
}

export function useDocumentWriteApprovals(
  organizationId: string,
  threadId: string | undefined,
) {
  const { approvals, isLoading } = useActiveApprovals(organizationId);

  const documentWriteApprovals = useMemo((): DocumentWriteApproval[] => {
    if (!approvals || !threadId) return [];
    return approvals
      .filter(
        (a) =>
          a.threadId === threadId &&
          a.resourceType === 'document_write' &&
          a.metadata !== undefined,
      )
      .map((a) => ({
        _id: toId<'approvals'>(a._id),
        status: a.status,
        metadata: normalizeDocumentWriteMetadata(
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by resourceType filter above
          a.metadata as unknown as DocumentWriteMetadata,
        ),
        executedAt: a.executedAt,
        executionError: a.executionError,
        _creationTime: a._creationTime,
        messageId: a.messageId,
      }));
  }, [approvals, threadId]);

  return {
    approvals: documentWriteApprovals,
    isLoading,
  };
}

export interface ToolUsage {
  toolName: string;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  input?: string;
  output?: string;
  costEstimateCents?: number;
}

/** @deprecated Use ToolUsage */
export type SubAgentUsage = ToolUsage;

export interface ContextStats {
  totalTokens: number;
  messageCount: number;
  approvalCount: number;
  hasRag: boolean;
}

export interface StructuredCitation {
  index: number;
  type: 'rag' | 'web';
  source: string;
  fileId?: string;
  url?: string;
  page?: number;
  relevance?: number;
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
  toolsUsage?: ToolUsage[];
  contextWindow?: string;
  contextStats?: ContextStats;
  costEstimateCents?: number;
  citations?: StructuredCitation[];
}

export function useMessageError(threadId: string | null) {
  const { data } = useConvexQuery(
    api.threads.get_message_error.getMessageError,
    threadId ? { threadId } : 'skip',
  );

  return data ?? null;
}

export function useMessageMetadata(
  messageId: string | null,
  threadId?: string | null,
) {
  const { data: metadata, isLoading } = useConvexQuery(
    api.message_metadata.queries.getMessageMetadata,
    messageId ? { messageId, ...(threadId ? { threadId } : {}) } : 'skip',
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
          toolsUsage: metadata.toolsUsage ?? metadata.subAgentUsage,
          contextWindow: metadata.contextWindow,
          contextStats: metadata.contextStats,
          costEstimateCents: metadata.costEstimateCents,
          citations: metadata.citations,
        }
      : undefined,
    isLoading,
  };
}
