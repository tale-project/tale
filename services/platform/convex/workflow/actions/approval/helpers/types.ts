import type { Id } from '../../../../_generated/dataModel';
import type { ApprovalResourceType } from '../../../../model/approvals/types';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalPriority = 'low' | 'medium' | 'high' | 'urgent';

export type ApprovalData = {
  _id: Id<'approvals'>;
  _creationTime: number;
  organizationId: string;
  wfExecutionId?: Id<'wfExecutions'>;
  stepSlug?: string;
  status: ApprovalStatus;
  approvedBy?: string;
  reviewedAt?: number;
  resourceType: ApprovalResourceType;
  resourceId: string;
  priority: ApprovalPriority;
  dueDate?: number;
  metadata?: unknown;
};

// Actions should return data directly (not wrapped in { data: ... })
// because execute_action_node wraps the result in output: { type: 'action', data: result }
export type CreateApprovalResult = ApprovalData | null;

export type UpdateApprovalStatusResult = ApprovalData | null;

export type GetApprovalResult = ApprovalData | null;

export type ListApprovalsResult = ApprovalData[];
