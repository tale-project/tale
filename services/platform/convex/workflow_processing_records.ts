/**
 * Workflow Processing Records API - Thin wrappers around model functions.
 *
 * All find operations are mutations that atomically claim/lock records
 * to prevent concurrent workflow executions from processing the same entity.
 */

import { internalQuery, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import * as WorkflowProcessingRecordsModel from './model/workflow_processing_records';

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

/**
 * Find and claim a single unprocessed record with smart index selection.
 *
 * The filterExpression parameter enables flexible querying:
 * - Simple equality conditions (e.g., 'status == "closed"') are used for index optimization
 * - Complex conditions (e.g., 'daysAgo(metadata.resolved_at) > 30') are applied as post-filters
 *
 * Examples:
 * - Find any unprocessed conversation: { tableName: 'conversations' }
 * - Find closed conversations: { tableName: 'conversations', filterExpression: 'status == "closed"' }
 * - Find stale closed conversations: { tableName: 'conversations', filterExpression: 'status == "closed" && daysAgo(metadata.resolved_at) > 30' }
 */
export const findUnprocessed = internalMutation({
  args: {
    organizationId: v.string(),
    tableName: tableNameValidator,
    wfDefinitionId: v.string(),
    backoffHours: v.number(),
    filterExpression: v.optional(v.string()),
  },
  returns: v.object({ document: v.union(v.any(), v.null()) }),
  handler: async (ctx, args) =>
    WorkflowProcessingRecordsModel.findUnprocessed(ctx, args),
});

/** Record that a document has been processed by a workflow. */
export const recordProcessed = internalMutation({
  args: {
    organizationId: v.string(),
    tableName: tableNameValidator,
    recordId: v.string(),
    wfDefinitionId: v.string(),
    recordCreationTime: v.number(),
    metadata: v.optional(v.any()),
  },
  returns: v.id('workflowProcessingRecords'),
  handler: async (ctx, args) =>
    WorkflowProcessingRecordsModel.recordProcessed(ctx, args),
});

/** Get a processing record by ID. */
export const getProcessingRecordById = internalQuery({
  args: {
    processingRecordId: v.id('workflowProcessingRecords'),
  },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) =>
    WorkflowProcessingRecordsModel.getProcessingRecordById(ctx, args),
});
