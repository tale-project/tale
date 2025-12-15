/**
 * Workflow Processing Records workflow actions
 *
 * These actions provide operations for tracking which entities have been processed by workflows,
 * enabling efficient incremental processing. They:
 * - Track processing history per workflow per table
 * - Use Convex indexes for efficient queries
 * - Support resume optimization to avoid scanning all documents
 * - Handle concurrent workflow executions safely
 */

import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';

import { findUnprocessed } from './helpers/find_unprocessed';
import { findUnprocessedOpenConversation } from './helpers/find_unprocessed_open_conversation';
import { findProductRecommendationByStatus } from './helpers/find_product_recommendation_by_status';
import { recordProcessed } from './helpers/record_processed';
import type { TableName } from './helpers/types';

// Common field validators
// Note: tableNameValidator mirrors the TableName type from helpers/types.ts
// Both must be kept in sync when adding new table names
const tableNameValidator = v.union(
  v.literal('customers'),
  v.literal('products'),
  v.literal('documents'),
  v.literal('conversations'),
  v.literal('approvals'),
  v.literal('onedriveSyncConfigs'),
  v.literal('websitePages'),
  v.literal('exampleMessages'),
);

const statusValidator = v.union(
  v.literal('pending'),
  v.literal('approved'),
  v.literal('rejected'),
);

// Type for workflow processing records operation params (discriminated union)
type WorkflowProcessingRecordsActionParams =
  | {
      operation: 'find_unprocessed';
      tableName: TableName;
      backoffHours: number;
    }
  | {
      operation: 'find_unprocessed_open_conversation';
      backoffHours: number;
    }
  | {
      operation: 'find_product_recommendation_by_status';
      backoffHours: number;
      status: 'pending' | 'approved' | 'rejected';
    }
  | {
      operation: 'record_processed';
      tableName: TableName;
      recordId: string;
      metadata?: unknown;
    };

export const workflowProcessingRecordsAction: ActionDefinition<WorkflowProcessingRecordsActionParams> =
  {
    type: 'workflow_processing_records',
    title: 'Workflow Processing Records Operation',
    description:
      'Execute workflow processing records operations (find_unprocessed, find_unprocessed_open_conversation, find_product_recommendation_by_status, record_processed). Returns at most one matching document or null if none found. organizationId and rootWfDefinitionId are automatically read from workflow context variables.',
    parametersValidator: v.union(
      // find_unprocessed: Find one unprocessed record from a table
      v.object({
        operation: v.literal('find_unprocessed'),
        tableName: tableNameValidator,
        backoffHours: v.number(),
      }),
      // find_unprocessed_open_conversation: Find one unprocessed open conversation
      v.object({
        operation: v.literal('find_unprocessed_open_conversation'),
        backoffHours: v.number(),
      }),
      // find_product_recommendation_by_status: Find one product recommendation by status
      v.object({
        operation: v.literal('find_product_recommendation_by_status'),
        backoffHours: v.number(),
        status: statusValidator,
      }),
      // record_processed: Record that a document has been processed
      v.object({
        operation: v.literal('record_processed'),
        tableName: tableNameValidator,
        recordId: v.string(),
        metadata: v.optional(v.any()),
      }),
    ),

  async execute(ctx, params, variables) {
    // Read and validate organizationId and wfDefinitionId from workflow context variables
    const organizationId = variables?.organizationId;
    const wfDefinitionId = variables?.rootWfDefinitionId;

    if (typeof organizationId !== 'string' || !organizationId) {
      throw new Error(
        'workflow_processing_records requires a non-empty string organizationId in workflow context',
      );
    }
    if (typeof wfDefinitionId !== 'string' || !wfDefinitionId) {
      throw new Error(
        'workflow_processing_records requires a non-empty string rootWfDefinitionId in workflow context',
      );
    }

    switch (params.operation) {
      case 'find_unprocessed': {
        return await findUnprocessed(ctx, {
          organizationId,
          tableName: params.tableName, // Required by validator
          wfDefinitionId,
          backoffHours: params.backoffHours, // Required by validator
        });
      }

      case 'find_unprocessed_open_conversation': {
        return await findUnprocessedOpenConversation(ctx, {
          organizationId,
          wfDefinitionId,
          backoffHours: params.backoffHours, // Required by validator
        });
      }

      case 'find_product_recommendation_by_status': {
        return await findProductRecommendationByStatus(ctx, {
          organizationId,
          wfDefinitionId,
          backoffHours: params.backoffHours, // Required by validator
          status: params.status, // Required by validator
        });
      }

      case 'record_processed': {
        return await recordProcessed(ctx, {
          organizationId,
          tableName: params.tableName, // Required by validator
          recordId: params.recordId, // Required by validator
          wfDefinitionId,
          metadata: params.metadata,
        });
      }

      default:
        throw new Error(
          `Unsupported workflow_processing_records operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
