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

export const workflowProcessingRecordsAction: ActionDefinition<{
  operation:
    | 'find_unprocessed'
    | 'find_unprocessed_open_conversation'
    | 'find_product_recommendation_by_status'
    | 'record_processed';
  organizationId: string;
  tableName?: TableName;
  workflowId: string;
  backoffHours?: number;
  status?: 'pending' | 'approved' | 'rejected';
  documentId?: string;
  documentCreationTime?: number;
  metadata?: unknown;
}> = {
  type: 'workflow_processing_records',
  title: 'Workflow Processing Records Operation',
  description:
    'Execute workflow processing records operations (find_unprocessed, find_unprocessed_open_conversation, find_product_recommendation_by_status, record_processed). Always fetches exactly one document.',
  parametersValidator: v.object({
    operation: v.union(
      v.literal('find_unprocessed'),
      v.literal('find_unprocessed_open_conversation'),
      v.literal('find_product_recommendation_by_status'),
      v.literal('record_processed'),
    ),
    organizationId: v.string(),
    tableName: v.optional(
      v.union(
        v.literal('customers'),
        v.literal('products'),
        v.literal('documents'),
        v.literal('conversations'),
        v.literal('approvals'),
        v.literal('onedriveSyncConfigs'),
        v.literal('websitePages'),
        v.literal('exampleMessages'),
      ),
    ),
    workflowId: v.string(),
    backoffHours: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('approved'),
        v.literal('rejected'),
      ),
    ),
    documentId: v.optional(v.string()),
    documentCreationTime: v.optional(v.number()),
    metadata: v.optional(v.any()),
  }),

  async execute(ctx, params) {
    switch (params.operation) {
      case 'find_unprocessed': {
        if (!params.tableName) {
          throw new Error(
            'find_unprocessed operation requires tableName parameter',
          );
        }
        if (params.backoffHours === undefined) {
          throw new Error(
            'find_unprocessed operation requires backoffHours parameter',
          );
        }

        return await findUnprocessed(ctx, {
          organizationId: params.organizationId,
          tableName: params.tableName,
          workflowId: params.workflowId,
          backoffHours: params.backoffHours,
        });
      }

      case 'find_unprocessed_open_conversation': {
        if (params.backoffHours === undefined) {
          throw new Error(
            'find_unprocessed_open_conversation operation requires backoffHours parameter',
          );
        }

        return await findUnprocessedOpenConversation(ctx, {
          organizationId: params.organizationId,
          workflowId: params.workflowId,
          backoffHours: params.backoffHours,
        });
      }

      case 'find_product_recommendation_by_status': {
        if (params.backoffHours === undefined) {
          throw new Error(
            'find_product_recommendation_by_status operation requires backoffHours parameter',
          );
        }
        if (!params.status) {
          throw new Error(
            'find_product_recommendation_by_status operation requires status parameter',
          );
        }

        return await findProductRecommendationByStatus(ctx, {
          organizationId: params.organizationId,
          workflowId: params.workflowId,
          backoffHours: params.backoffHours,
          status: params.status,
        });
      }

      case 'record_processed': {
        if (!params.tableName) {
          throw new Error(
            'record_processed operation requires tableName parameter',
          );
        }
        if (!params.documentId) {
          throw new Error(
            'record_processed operation requires documentId parameter',
          );
        }
        if (params.documentCreationTime === undefined) {
          throw new Error(
            'record_processed operation requires documentCreationTime parameter',
          );
        }

        return await recordProcessed(ctx, {
          organizationId: params.organizationId,
          tableName: params.tableName,
          documentId: params.documentId,
          workflowId: params.workflowId,
          documentCreationTime: params.documentCreationTime,
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
