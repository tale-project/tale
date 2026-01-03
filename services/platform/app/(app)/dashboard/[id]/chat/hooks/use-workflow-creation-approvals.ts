/**
 * Hook for fetching workflow creation approvals in a chat thread
 */

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { WorkflowCreationMetadata } from '@/convex/model/approvals/types';

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
    api.approvals.getWorkflowCreationApprovalsForThread,
    threadId ? { threadId } : 'skip',
  );

  // Transform the approvals to a more usable format
  const workflowCreationApprovals: WorkflowCreationApproval[] = (approvals || [])
    .filter((a) => a.resourceType === 'workflow_creation' && a.metadata)
    .map((a) => ({
      _id: a._id,
      status: a.status as 'pending' | 'approved' | 'rejected',
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
