import type { Id } from '../../../../_generated/dataModel';
import type { ApprovalResourceType } from '../../../../model/approvals/types';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalPriority = 'low' | 'medium' | 'high' | 'urgent';

export type CreateApprovalResult = {
  operation: 'create_approval';
  approvalId: Id<'approvals'>;
  success: boolean;
  timestamp: number;
};

export type UpdateApprovalStatusResult = {
  operation: 'update_approval_status';
  approvalId: Id<'approvals'>;
  status: ApprovalStatus;
  success: boolean;
  timestamp: number;
};

export type GetApprovalResult = {
  operation: 'get_approval';
  approval: {
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
  } | null;
};

export type ListApprovalsResult = {
  operation:
    | 'list_pending_approvals'
    | 'list_approvals_for_execution'
    | 'list_pending_approvals_for_execution'
    | 'get_approval_history';
  approvals: Array<{
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
  }>;
  count: number;
};
