import { useUIMessages, type UIMessage } from '@convex-dev/agent/react';
import { useMemo } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type { WorkflowCreationMetadata } from '@/convex/approvals/types';
import type { HumanInputRequestMetadata } from '@/lib/shared/schemas/approvals';
import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useApprovals } from '@/app/features/approvals/hooks/queries';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { api } from '@/convex/_generated/api';

export type Thread = ConvexItemOf<typeof api.threads.queries.listThreads>;

export function useThreads() {
  const { data, isLoading } = useConvexQuery(api.threads.queries.listThreads);

  const threads = useMemo(
    () => data?.slice().sort((a, b) => b._creationTime - a._creationTime),
    [data],
  );

  return {
    threads,
    isLoading,
  };
}

export type CustomAgent = ConvexItemOf<
  typeof api.custom_agents.queries.listCustomAgents
>;

export function useChatAgents(organizationId: string) {
  const { selectedTeamId } = useTeamFilter();
  const { data } = useConvexQuery(api.custom_agents.queries.listCustomAgents, {
    organizationId,
  });

  const agents = useMemo(() => {
    if (!data) return undefined;
    return data.filter((agent) => {
      if (agent.status !== 'active') return false;
      if (!selectedTeamId) return true;
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

export function useThreadMessages(threadId: string | null) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SDK type mismatch: return type narrowed to usable shape
  const { results } = useUIMessages(
    // oxlint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-type-assertion -- SDK type mismatch: streaming query return type incompatible with useUIMessages expectations
    api.threads.queries.getThreadMessagesStreaming as any,
    threadId ? { threadId } : 'skip',
    { initialNumItems: 100, stream: true },
  ) as unknown as { results: UIMessage[] | undefined };

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
        _id: a._id,
        status: a.status,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex metadata uses v.any(); cast to specific schema type
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
        _id: a._id,
        status: a.status,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex metadata uses v.any(); cast to specific metadata shape
        metadata: a.metadata as IntegrationOperationMetadata,
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
        _id: a._id,
        status: a.status,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex metadata uses v.any(); cast to specific metadata shape
        metadata: a.metadata as WorkflowCreationMetadata,
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
  hasIntegrations: boolean;
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
