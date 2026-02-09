/**
 * Hook for fetching workflow creation approvals in a chat thread
 */

import { useQuery } from 'convex/react';

import type { Id } from '@/convex/_generated/dataModel';
import type { WorkflowCreationMetadata } from '@/convex/approvals/types';

import { api } from '@/convex/_generated/api';

export interface WorkflowCreationApproval {
  _id: Id<'approvals'>;
  status: 'pending' | 'approved' | 'rejected';
  metadata: WorkflowCreationMetadata;
  executedAt?: number;
  executionError?: string;
  _creationTime: number;
  messageId?: string; // The message ID where the approval was requested
}

/**
 * Hook to fetch workflow creation approvals for a chat thread
 */
export function useWorkflowCreationApprovals(threadId: string | undefined) {
  const approvals = useQuery(
    api.approvals.queries.getWorkflowCreationApprovalsForThread,
    threadId ? { threadId } : 'skip',
  );

  type ApprovalItem = NonNullable<typeof approvals>[number];

  // Transform the approvals to a more usable format
  const workflowCreationApprovals: WorkflowCreationApproval[] = (
    approvals || []
  )
    .filter(
      (a: ApprovalItem) => a.resourceType === 'workflow_creation' && a.metadata,
    )
    .map((a: ApprovalItem) => ({
      _id: a._id,
      status: a.status,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex metadata uses v.any(); cast to specific metadata shape
      metadata: a.metadata as WorkflowCreationMetadata,
      executedAt: a.executedAt,
      executionError: a.executionError,
      _creationTime: a._creationTime,
      messageId: a.messageId,
    }));

  return {
    approvals: workflowCreationApprovals,
    isLoading: approvals === undefined && threadId !== undefined,
  };
}
