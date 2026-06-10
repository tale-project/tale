import { useUIMessages } from '@convex-dev/agent/react';
import type { FunctionReturnType } from 'convex/server';
import { createContext, createElement, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';
import { isRecord } from '@/lib/utils/type-guards';

import type { RouteReason } from '../utils/route-reason';

export interface Thread {
  _id: string;
  _creationTime: number;
  title?: string;
  status: 'active' | 'archived' | 'deleted';
  userId?: string;
  generationStatus?: 'generating' | 'idle';
  teamId?: string;
  isShared?: boolean;
  projectId?: string;
}

// Shared so the `/dashboard/$id/chat` loader primes the same page size the
// sidebar's `useThreads` reads — single source of truth.
export const THREADS_PAGE_SIZE = 20;

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
  // Memoize so a parent re-render doesn't hand the paginated query a fresh
  // args object (new reference) and churn the subscription.
  const queryArgs = useMemo(
    () =>
      skip
        ? ('skip' as const)
        : {
            ...(teamId ? { teamId } : {}),
            ...(organizationId ? { organizationId } : {}),
          },
    [skip, teamId, organizationId],
  );
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
    // First-page load with no cached results. The chat sidebar gates its
    // skeleton on this so it never flashes the empty state before the real
    // chats arrive (Convex returns `results: []` while the first page loads,
    // which is indistinguishable from "no chats" without this flag).
    isLoadingFirstPage: status === 'LoadingFirstPage',
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
  const queryArgs = useMemo(
    () =>
      skip
        ? ('skip' as const)
        : {
            ...(teamId ? { teamId } : {}),
            ...(organizationId ? { organizationId } : {}),
          },
    [skip, teamId, organizationId],
  );
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

/**
 * Count the current user's chats by lifecycle state for the given org. Powers
 * the "manage all my chats" settings section (how many a bulk archive/delete
 * would touch, and whether the actions should be enabled).
 */
export function useChatCounts(organizationId?: string | null) {
  return useConvexQuery(
    api.threads.queries.countMyChats,
    organizationId ? { organizationId } : {},
  );
}

export interface ComposerModeMeta {
  label: string;
  icon?: string;
  tooltip?: string;
  order?: number;
}

export interface ChatAgent {
  name: string;
  /**
   * Pre-resolved to the app-default locale (`en`) via `resolveAgentLocale` so
   * legacy raw-read consumers always see a populated string. Components that
   * render to the user should call `resolveAgentLocale(agent, userLocale)`
   * using the `i18n` map below for proper user-locale resolution.
   */
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
  integrationBindings?: string[];
  roleRestriction?: string;
  conversationStarters?: string[];
  composerMode?: ComposerModeMeta;
  i18n?: Record<
    string,
    {
      displayName?: string;
      description?: string;
      conversationStarters?: string[];
      systemInstructions?: string;
    }
  >;
}

function isComposerModeMeta(value: unknown): value is ComposerModeMeta {
  if (!isRecord(value)) return false;
  const label = value.label;
  return typeof label === 'string' && label.length > 0;
}

export function useChatAgents(organizationId: string) {
  const { agents: rawAgents, isLoading } = useListAgents(organizationId);
  const { i18n: i18nCtx } = useTranslation();
  const locale = i18nCtx.language;

  const agents = useMemo(() => {
    if (!rawAgents) return undefined;
    const chatAgents: ChatAgent[] = [];
    for (const a of rawAgents) {
      if (a && typeof a.name === 'string' && a.visibleInChat === true) {
        const resolved = resolveAgentLocale(a, locale);
        if (!resolved.displayName) continue;
        chatAgents.push({
          name: a.name,
          displayName: resolved.displayName,
          description: resolved.description,
          visibleInChat: a.visibleInChat,
          primaryBehavior:
            'primaryBehavior' in a &&
            (a.primaryBehavior === 'chat' ||
              a.primaryBehavior === 'image-generation')
              ? a.primaryBehavior
              : undefined,
          supportedModels: a.supportedModels,
          integrationBindings: Array.isArray(a.integrationBindings)
            ? a.integrationBindings
            : undefined,
          conversationStarters: resolved.conversationStarters,
          composerMode:
            'composerMode' in a && isComposerModeMeta(a.composerMode)
              ? a.composerMode
              : undefined,
          i18n: a.i18n,
        });
      }
    }
    return chatAgents;
  }, [rawAgents, locale]);

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

/**
 * Resolved (completed/rejected) human-input requests for the thread. The
 * active-approvals subscription only carries pending/executing rows;
 * `useMergedChatItems` splices these into the message flow so an answered
 * request stays visible — and editable — inline in the history.
 */
export function useResolvedHumanInputRequests(
  organizationId: string,
  threadId: string | undefined,
) {
  const { data, isLoading } = useConvexQuery(
    api.approvals.queries.listResolvedHumanInputRequestsByThread,
    threadId ? { organizationId, threadId } : 'skip',
  );

  // `undefined` while the subscription is in flight — consumers use that to
  // hold off pill suppression until the cards are actually available.
  const requests = useMemo((): HumanInputRequest[] | undefined => {
    if (!data) return undefined;
    return data
      .filter((a) => a.metadata !== undefined)
      .map((a) => ({
        _id: toId<'approvals'>(a._id),
        status: a.status,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Metadata shape is guaranteed by the query's resourceType filter
        metadata: a.metadata as unknown as HumanInputRequestMetadata,
        _creationTime: a._creationTime,
        messageId: a.messageId,
        wfExecutionId: a.wfExecutionId
          ? toId<'wfExecutions'>(a.wfExecutionId)
          : undefined,
      }));
  }, [data]);

  return { requests, isLoading };
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
  /** Agent that answered (the concrete agent the Auto router resolved to, or a
   *  pinned agent). Also used by the dev TTFT probe to reproduce its tools. */
  agentSlug?: string;
  /** Why the Auto router chose `agentSlug`; absent when the user pinned the agent. */
  autoRouteReason?: RouteReason;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  reasoning?: string;
  durationMs?: number;
  timeToFirstTokenMs?: number;
  /** Action-relative time to the first reasoning ("thinking") delta. */
  timeToFirstReasoningMs?: number;
  /** Send-relative time to the first user-visible token (reasoning or content). */
  timeFromSendMs?: number;
  /** Pre-answer wall-clock the user waited, INCLUDING Auto-routing latency
   *  (markGenerating → first answer token). Preferred over timeToFirstTokenMs
   *  for the "Thought for Ns" summary so it matches the live timer. */
  thinkingDurationMs?: number;
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

/**
 * Raw metadata row as returned by the Convex `getMessageMetadata` /
 * `getThreadMessageMetadata` queries (non-null variant). Derived from the
 * generated return type so the per-message and batched paths stay in lockstep
 * with the `messageMetadataValidator` shape.
 */
type RawMessageMetadataRow = NonNullable<
  FunctionReturnType<typeof api.message_metadata.queries.getMessageMetadata>
>;

/** Projected shape the chat UI consumes (incl. guardrails `blockedReason`). */
type ProjectedMessageMetadata = MessageMetadata & {
  /**
   * Guardrails pipeline flags: set when chat_filter / PII /
   * moderation_provider blocked the message. `message-bubble` swaps to
   * <BlockedNotice/> before rendering any content block (text, reasoning,
   * tools) when this is present.
   */
  blockedReason?: RawMessageMetadataRow['blockedReason'];
};

/**
 * Single source of truth for the per-message → projected metadata mapping.
 * Both the per-message subscription (`useMessageMetadata`) and the batched
 * thread subscription (`useThreadMessageMetadata`) project through this so the
 * returned object shape is byte-identical regardless of which path supplied
 * the row — callers depend on every field below (agentSlug, autoRouteReason,
 * blockedReason, …).
 */
function projectMessageMetadata(
  metadata: RawMessageMetadataRow,
): ProjectedMessageMetadata {
  return {
    model: metadata.model,
    provider: metadata.provider,
    agentSlug: metadata.agentSlug,
    autoRouteReason: metadata.autoRouteReason,
    inputTokens: metadata.inputTokens,
    outputTokens: metadata.outputTokens,
    totalTokens: metadata.totalTokens,
    reasoningTokens: metadata.reasoningTokens,
    cachedInputTokens: metadata.cachedInputTokens,
    reasoning: metadata.reasoning,
    durationMs: metadata.durationMs,
    timeToFirstTokenMs: metadata.timeToFirstTokenMs,
    timeToFirstReasoningMs: metadata.timeToFirstReasoningMs,
    timeFromSendMs: metadata.timeFromSendMs,
    thinkingDurationMs: metadata.thinkingDurationMs,
    toolsUsage: metadata.toolsUsage ?? metadata.subAgentUsage,
    contextWindow: metadata.contextWindow,
    contextStats: metadata.contextStats,
    costEstimateCents: metadata.costEstimateCents,
    citations: metadata.citations,
    blockedReason: metadata.blockedReason,
  };
}

/**
 * Shared, batched metadata for a whole thread. When a `ThreadMessageMetadata`
 * provider is mounted above the message list, `useMessageMetadata` reads each
 * row from this map instead of opening its own per-message subscription —
 * collapsing N subscriptions (one per assistant bubble) into one thread-level
 * subscription. `null` (the default) means no provider is mounted, so every
 * `useMessageMetadata` transparently falls back to its per-message query.
 */
interface ThreadMessageMetadataValue {
  /** messageId → projected metadata for rows present in the batched result. */
  byMessageId: Map<string, ProjectedMessageMetadata>;
  /** True while the batched thread subscription's first result is pending. */
  isLoading: boolean;
}

const ThreadMessageMetadataContext =
  createContext<ThreadMessageMetadataValue | null>(null);

/** The in-flight turn's resolved Auto route, surfaced to descendant bubbles so a
 *  STREAMING assistant bubble can show "Routed to X" the moment routing resolves
 *  — the persisted `metadata.autoRouteReason` only lands at turn completion. */
export interface ThreadLiveRoute {
  agentName: string;
  reason: RouteReason;
}

const ThreadLiveRouteContext = createContext<ThreadLiveRoute | null>(null);

export function useThreadLiveRoute(): ThreadLiveRoute | null {
  return useContext(ThreadLiveRouteContext);
}

/** The in-flight turn's server start (`generationStartTime`, stamped at
 *  markGenerating BEFORE Auto routing). The authoritative anchor for the live
 *  "Thinking · Ns" timer — identical across the gap-shell→bubble handoff and
 *  the new-chat remount, so the timer never resets. `null` on idle threads. */
const ThreadGenerationStartContext = createContext<number | null>(null);

export function useThreadGenerationStart(): number | null {
  return useContext(ThreadGenerationStartContext);
}

/**
 * Subscribe once to ALL metadata rows for `threadId` and expose them as a
 * `messageId → projected metadata` map for the provider below. Mount this near
 * the message list; individual bubbles then read via `useMessageMetadata`
 * without each opening their own subscription.
 */
function useThreadMessageMetadata(
  threadId: string | null,
): ThreadMessageMetadataValue {
  const { data: rows, isLoading } = useConvexQuery(
    api.message_metadata.queries.getThreadMessageMetadata,
    threadId ? { threadId } : 'skip',
  );

  return useMemo(() => {
    const byMessageId = new Map<string, ProjectedMessageMetadata>();
    if (rows) {
      for (const row of rows) {
        byMessageId.set(row.messageId, projectMessageMetadata(row));
      }
    }
    return { byMessageId, isLoading };
  }, [rows, isLoading]);
}

/**
 * Provides a batched, thread-level metadata map to descendant `MessageBubble`s.
 * When present, per-bubble `useMessageMetadata` calls resolve from the shared
 * map (one subscription for the whole thread) and only fall back to a
 * per-message subscription for rows not yet in the batch (e.g. the just-created
 * row for a streaming turn, or the error-path id mismatch the per-message query
 * resolves via its `by_threadId` fallback).
 */
export function ThreadMessageMetadataProvider({
  threadId,
  liveRoute = null,
  generationStartMs = null,
  children,
}: {
  threadId: string | null;
  /** The in-flight turn's resolved Auto route (slug→display-name mapped by the
   *  caller), exposed to streaming bubbles via `useThreadLiveRoute`. */
  liveRoute?: ThreadLiveRoute | null;
  /** The in-flight turn's server start, exposed to bubbles via
   *  `useThreadGenerationStart` so the in-bubble timeline anchors its live timer
   *  to the same clock as the gap shell (no reset across the handoff). */
  generationStartMs?: number | null;
  children: ReactNode;
}) {
  const value = useThreadMessageMetadata(threadId);
  // `createElement` (not JSX) so this hooks module stays a `.ts` file — the
  // provider is a thin convenience wrapper around the contexts + hook above.
  return createElement(
    ThreadMessageMetadataContext.Provider,
    { value },
    createElement(
      ThreadLiveRouteContext.Provider,
      { value: liveRoute },
      createElement(
        ThreadGenerationStartContext.Provider,
        { value: generationStartMs },
        children,
      ),
    ),
  );
}

export function useMessageMetadata(
  messageId: string | null,
  threadId?: string | null,
) {
  // Shared batched map (present only when a ThreadMessageMetadataProvider is
  // mounted). When it already holds this message's row we skip opening a
  // per-message subscription entirely.
  const shared = useContext(ThreadMessageMetadataContext);
  const sharedMetadata =
    messageId && shared ? shared.byMessageId.get(messageId) : undefined;
  const hasShared = sharedMetadata !== undefined;

  // Per-message fallback. Gated to 'skip' whenever the shared map already
  // satisfied the read — this is the subscription-count win. Also preserves
  // the original behavior 1:1 when no provider is mounted (shared === null).
  const { data: metadata, isLoading } = useConvexQuery(
    api.message_metadata.queries.getMessageMetadata,
    messageId && !hasShared
      ? { messageId, ...(threadId ? { threadId } : {}) }
      : 'skip',
  );

  if (hasShared) {
    return { metadata: sharedMetadata, isLoading: false };
  }

  return {
    metadata: metadata ? projectMessageMetadata(metadata) : undefined,
    // While a provider is mounted but this row hasn't landed in the batch yet,
    // surface the batch's loading state so a bubble doesn't flash "loaded with
    // no metadata" before the thread subscription's first result arrives.
    isLoading: shared ? shared.isLoading || isLoading : isLoading,
  };
}
