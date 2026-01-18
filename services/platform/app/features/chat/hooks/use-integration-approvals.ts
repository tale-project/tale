/**
 * Hook for fetching integration operation approvals in a chat thread
 */

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

/**
 * Metadata for an integration operation approval
 */
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
  messageId?: string; // The message ID where the approval was requested
}

/**
 * Hook to fetch integration approvals for a chat thread
 */
export function useIntegrationApprovals(threadId: string | undefined) {
  const approvals = useQuery(
    api.approvals.queries.getPendingIntegrationApprovalsForThread,
    threadId ? { threadId } : 'skip',
  );

  type ApprovalItem = NonNullable<typeof approvals>[number];

  // Transform the approvals to a more usable format
  const integrationApprovals: IntegrationApproval[] = (approvals || [])
    .filter((a: ApprovalItem): a is ApprovalItem & { metadata: NonNullable<ApprovalItem['metadata']> } =>
      a.resourceType === 'integration_operation' && a.metadata !== undefined)
    .map((a: ApprovalItem & { metadata: NonNullable<ApprovalItem['metadata']> }): IntegrationApproval => ({
      _id: a._id,
      status: a.status as 'pending' | 'approved' | 'rejected',
      metadata: a.metadata as unknown as IntegrationOperationMetadata,
      executedAt: a.executedAt,
      executionError: a.executionError,
      _creationTime: a._creationTime,
      messageId: a.messageId,
    }));

  return {
    approvals: integrationApprovals,
    isLoading: approvals === undefined && threadId !== undefined,
  };
}
