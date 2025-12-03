/**
 * Approval workflow actions
 *
 * These actions provide operations for managing approvals in workflows, enabling:
 * - Creating approval requests
 * - Updating approval status (approve/reject)
 * - Querying approval state
 * - Listing pending approvals
 * - Getting approval history
 */

import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { Id } from '../../../_generated/dataModel';
import { createApproval } from './helpers/create_approval';
import { updateApprovalStatus } from './helpers/update_approval_status';
import { getApproval } from './helpers/get_approval';
import { listPendingApprovals } from './helpers/list_pending_approvals';
import { listApprovalsForExecution } from './helpers/list_approvals_for_execution';
import { listPendingApprovalsForExecution } from './helpers/list_pending_approvals_for_execution';
import { getApprovalHistory } from './helpers/get_approval_history';

export const approvalAction: ActionDefinition<{
  operation:
    | 'create_approval'
    | 'update_approval_status'
    | 'get_approval'
    | 'list_pending_approvals'
    | 'list_approvals_for_execution'
    | 'list_pending_approvals_for_execution'
    | 'get_approval_history';
  // Common fields
  organizationId?: string;
  approvalId?: Id<'approvals'>;
  executionId?: Id<'wfExecutions'>;
  // Create approval fields
  resourceType?: string;
  resourceId?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  requestedBy?: string;
  dueDate?: number;
  description?: string;
  stepSlug?: string;
  metadata?: unknown;
  // Update approval status fields
  status?: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  comments?: string;
}> = {
  type: 'approval',
  title: 'Approval Operation',
  description:
    'Execute approval operations (create, update status, get, list pending, list for execution, get history)',
  parametersValidator: v.object({
    operation: v.union(
      v.literal('create_approval'),
      v.literal('update_approval_status'),
      v.literal('get_approval'),
      v.literal('list_pending_approvals'),
      v.literal('list_approvals_for_execution'),
      v.literal('list_pending_approvals_for_execution'),
      v.literal('get_approval_history'),
    ),
    // Common fields
    organizationId: v.optional(v.string()),
    approvalId: v.optional(v.id('approvals')),
    executionId: v.optional(v.id('wfExecutions')),
    // Create approval fields
    resourceType: v.optional(v.string()),
    resourceId: v.optional(v.string()),
    priority: v.optional(
      v.union(
        v.literal('low'),
        v.literal('medium'),
        v.literal('high'),
        v.literal('urgent'),
      ),
    ),
    requestedBy: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    description: v.optional(v.string()),
    stepSlug: v.optional(v.string()),
    metadata: v.optional(v.any()),
    // Update approval status fields
    status: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('approved'),
        v.literal('rejected'),
      ),
    ),
    approvedBy: v.optional(v.string()),
    comments: v.optional(v.string()),
  }),

  async execute(ctx, params) {
    switch (params.operation) {
      case 'create_approval': {
        if (!params.organizationId) {
          throw new Error(
            'create_approval operation requires organizationId parameter',
          );
        }
        if (!params.resourceType) {
          throw new Error(
            'create_approval operation requires resourceType parameter',
          );
        }
        if (!params.resourceId) {
          throw new Error(
            'create_approval operation requires resourceId parameter',
          );
        }
        if (!params.priority) {
          throw new Error(
            'create_approval operation requires priority parameter',
          );
        }

        return await createApproval(ctx, {
          organizationId: params.organizationId,
          resourceType: params.resourceType,
          resourceId: params.resourceId,
          priority: params.priority,
          requestedBy: params.requestedBy,
          dueDate: params.dueDate,
          description: params.description,
          wfExecutionId: params.executionId,
          stepSlug: params.stepSlug,
          metadata: params.metadata,
        });
      }

      case 'update_approval_status': {
        if (!params.approvalId) {
          throw new Error(
            'update_approval_status operation requires approvalId parameter',
          );
        }
        if (!params.status) {
          throw new Error(
            'update_approval_status operation requires status parameter',
          );
        }
        if (!params.approvedBy) {
          throw new Error(
            'update_approval_status operation requires approvedBy parameter',
          );
        }

        return await updateApprovalStatus(ctx, {
          approvalId: params.approvalId,
          status: params.status,
          approvedBy: params.approvedBy,
          comments: params.comments,
        });
      }

      case 'get_approval': {
        if (!params.approvalId) {
          throw new Error(
            'get_approval operation requires approvalId parameter',
          );
        }

        return await getApproval(ctx, {
          approvalId: params.approvalId,
        });
      }

      case 'list_pending_approvals': {
        if (!params.organizationId) {
          throw new Error(
            'list_pending_approvals operation requires organizationId parameter',
          );
        }

        return await listPendingApprovals(ctx, {
          organizationId: params.organizationId,
          resourceType: params.resourceType,
        });
      }

      case 'list_approvals_for_execution': {
        if (!params.executionId) {
          throw new Error(
            'list_approvals_for_execution operation requires executionId parameter',
          );
        }

        return await listApprovalsForExecution(ctx, {
          executionId: params.executionId,
        });
      }

      case 'list_pending_approvals_for_execution': {
        if (!params.executionId) {
          throw new Error(
            'list_pending_approvals_for_execution operation requires executionId parameter',
          );
        }

        return await listPendingApprovalsForExecution(ctx, {
          executionId: params.executionId,
        });
      }

      case 'get_approval_history': {
        if (!params.resourceType) {
          throw new Error(
            'get_approval_history operation requires resourceType parameter',
          );
        }
        if (!params.resourceId) {
          throw new Error(
            'get_approval_history operation requires resourceId parameter',
          );
        }

        return await getApprovalHistory(ctx, {
          resourceType: params.resourceType,
          resourceId: params.resourceId,
        });
      }

      default:
        throw new Error(
          `Unsupported approval operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
