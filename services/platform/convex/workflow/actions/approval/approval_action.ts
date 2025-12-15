/**
 * Approval workflow actions
 *
 * These actions provide operations for managing approvals in workflows, enabling:
 * - Creating approval requests
 */

import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { Id } from '../../../_generated/dataModel';
import { createApproval } from './helpers/create_approval';

// Common field validators
const priorityValidator = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('urgent'),
);

// Type for approval operation params (discriminated union)
type ApprovalActionParams = {
  operation: 'create_approval';
  resourceType: string;
  resourceId: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  executionId?: Id<'wfExecutions'>;
  requestedBy?: string;
  dueDate?: number;
  description?: string;
  stepSlug?: string;
  metadata?: unknown;
};

export const approvalAction: ActionDefinition<ApprovalActionParams> = {
  type: 'approval',
  title: 'Approval Operation',
  description:
    'Execute approval operations (create_approval). organizationId is automatically read from workflow context variables.',
  parametersValidator: v.union(
    // create_approval: Create a new approval request
    v.object({
      operation: v.literal('create_approval'),
      resourceType: v.string(),
      resourceId: v.string(),
      priority: priorityValidator,
      executionId: v.optional(v.id('wfExecutions')),
      requestedBy: v.optional(v.string()),
      dueDate: v.optional(v.number()),
      description: v.optional(v.string()),
      stepSlug: v.optional(v.string()),
      metadata: v.optional(v.any()),
    }),
  ),

  async execute(ctx, params, variables) {
    // Read organizationId from workflow context variables with proper type validation
    const organizationId = variables.organizationId;
    if (typeof organizationId !== 'string' || !organizationId) {
      throw new Error(
        'approval requires a non-empty string organizationId in workflow context',
      );
    }

    switch (params.operation) {
      case 'create_approval': {

        return await createApproval(ctx, {
          organizationId,
          resourceType: params.resourceType, // Required by validator
          resourceId: params.resourceId, // Required by validator
          priority: params.priority, // Required by validator
          requestedBy: params.requestedBy,
          dueDate: params.dueDate,
          description: params.description,
          wfExecutionId: params.executionId,
          stepSlug: params.stepSlug,
          metadata: params.metadata,
        });
      }

      default:
        throw new Error(
          `Unsupported approval operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
