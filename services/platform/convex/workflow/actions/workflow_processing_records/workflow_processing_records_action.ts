/**
 * Workflow Processing Records workflow actions
 *
 * These actions provide operations for tracking which entities have been processed by workflows,
 * enabling efficient incremental processing. They:
 * - Track processing history per workflow per table
 * - Use smart index selection for efficient queries based on filter expressions
 * - Support resume optimization to avoid scanning all documents
 * - Handle concurrent workflow executions safely
 */

import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';

import { findUnprocessed } from './helpers/find_unprocessed';
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
  v.literal('conversationMessages'),
  v.literal('approvals'),
  v.literal('onedriveSyncConfigs'),
  v.literal('websitePages'),
  v.literal('exampleMessages'),
);

// Type for workflow processing records operation params (discriminated union)
type WorkflowProcessingRecordsActionParams =
  | {
      operation: 'find_unprocessed';
      tableName: TableName;
      backoffHours: number;
      /**
       * Optional JEXL filter expression for advanced filtering.
       * Simple equality conditions (e.g., 'status == "closed"') will be used
       * for index-based query optimization.
       * Complex conditions (e.g., 'daysAgo(metadata.resolved_at) > 30') will be
       * applied as post-filters.
       *
       * @example 'status == "closed"'
       * @example 'status == "open" && priority == "high"'
       * @example 'status == "closed" && daysAgo(metadata.resolved_at) > 30'
       * @example 'status == "approved" && resourceType == "product_recommendation"'
       */
      filterExpression?: string;
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
    description: `Execute workflow processing records operations.

Operations:
- find_unprocessed: Find one unprocessed record from a table with optional filter expression
- record_processed: Record that a document has been processed

The find_unprocessed operation supports flexible filtering via filterExpression:
- Simple equality conditions (e.g., 'status == "closed"') are used for index optimization
- Complex conditions (e.g., 'daysAgo(metadata.resolved_at) > 30') are applied as post-filters
- Available transforms: daysAgo(), hoursAgo(), minutesAgo(), parseDate(), isBefore(), isAfter()

Examples:
- Find any conversation: { operation: 'find_unprocessed', tableName: 'conversations' }
- Find open conversations: { filterExpression: 'status == "open"' }
- Find stale closed conversations: { filterExpression: 'status == "closed" && daysAgo(metadata.resolved_at) > 30' }
- Find approved product recommendations: { tableName: 'approvals', filterExpression: 'status == "approved" && resourceType == "product_recommendation"' }

organizationId and rootWfDefinitionId are automatically read from workflow context variables.`,
    parametersValidator: v.union(
      // find_unprocessed: Find one unprocessed record from a table with optional filter
      v.object({
        operation: v.literal('find_unprocessed'),
        tableName: tableNameValidator,
        backoffHours: v.number(),
        filterExpression: v.optional(v.string()),
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
            tableName: params.tableName,
            wfDefinitionId,
            backoffHours: params.backoffHours,
            filterExpression: params.filterExpression,
          });
        }

        case 'record_processed': {
          return await recordProcessed(ctx, {
            organizationId,
            tableName: params.tableName,
            recordId: params.recordId,
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
