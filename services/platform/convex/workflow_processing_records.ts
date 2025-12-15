/**
 * Workflow Processing Records API - Thin wrappers around model functions
 *
 * This module provides Convex functions for tracking which entities have been processed by workflows,
 * enabling efficient incremental processing.
 *
 * Convex Functions (use via ctx.runQuery/ctx.runMutation):
 * - findUnprocessed: Find unprocessed documents using basic by_organizationId index
 * - findUnprocessedOpenConversation: Find unprocessed open conversations with inbound messages
 * - recordProcessed: Mark a document as processed
 *
 * For custom queries and helper functions, import directly from the model layer:
 * @example
 * ```typescript
 * import {
 *   findUnprocessedWithCustomQuery,
 *   isDocumentProcessed,
 *   getLatestProcessedCreationTime,
 * } from './model/workflow_processing_records';
 * ```
 */

import { internalQuery, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import * as WorkflowProcessingRecordsModel from './model/workflow_processing_records';

// =============================================================================
// INTERNAL OPERATIONS
// =============================================================================

/**
 * Find unprocessed records in a table for a specific workflow.
 *
 * Algorithm:
 * 1. Get the latest processed record (by recordCreationTime)
 * 2. Get the latest record in the target table (by _creationTime)
 * 3. If latest processed == latest in table OR no processing history exists:
 *    - Start from the earliest unprocessed record
 * 4. Otherwise:
 *    - Continue from where we left off (records with _creationTime > last processed)
 *
 * This approach:
 * - Avoids scanning all records
 * - Uses indexes efficiently
 * - Tracks processing progress per workflow per table
 * - Can resume from where it left off
 * - Always returns exactly one record (limit defaults to 1)
 */
export const findUnprocessed = internalQuery({
  args: {
    organizationId: v.string(),
    tableName: v.union(
      v.literal('customers'),
      v.literal('products'),
      v.literal('documents'),
      v.literal('conversations'),
      v.literal('approvals'),
      v.literal('onedriveSyncConfigs'),
      v.literal('websitePages'),
      v.literal('exampleMessages'),
    ),
    wfDefinitionId: v.string(),
    backoffHours: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    documents: v.array(v.any()),
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    return await WorkflowProcessingRecordsModel.findUnprocessed(ctx, args);
  },
});

/**
 * Find unprocessed open conversations where the latest message is inbound.
 *
 * This is a specific implementation using the hook mechanism.
 * Always returns exactly one conversation.
 */
export const findUnprocessedOpenConversation = internalQuery({
  args: {
    organizationId: v.string(),
    wfDefinitionId: v.string(),
    backoffHours: v.number(),
  },
  returns: v.object({
    conversations: v.array(v.any()),
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    return await WorkflowProcessingRecordsModel.findUnprocessedOpenConversation(
      ctx,
      args,
    );
  },
});

/**
 * Find product recommendation approvals by status.
 *
 * This is a general implementation that accepts status as a parameter.
 * Always returns exactly one approval.
 */
export const findProductRecommendationByStatus = internalQuery({
  args: {
    organizationId: v.string(),
    wfDefinitionId: v.string(),
    backoffHours: v.number(),
    status: v.union(
      v.literal('pending'),
      v.literal('approved'),
      v.literal('rejected'),
    ),
  },
  returns: v.object({
    approvals: v.array(v.any()),
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    return await WorkflowProcessingRecordsModel.findProductRecommendationByStatus(
      ctx,
      args,
    );
  },
});

/**
 * Record that a document has been processed by a workflow.
 * This should be called after successfully processing a document.
 */
export const recordProcessed = internalMutation({
  args: {
    organizationId: v.string(),
    tableName: v.union(
      v.literal('customers'),
      v.literal('products'),
      v.literal('documents'),
      v.literal('conversations'),
      v.literal('approvals'),
      v.literal('onedriveSyncConfigs'),
      v.literal('websitePages'),
      v.literal('exampleMessages'),
    ),
    recordId: v.string(),
    wfDefinitionId: v.string(),
    recordCreationTime: v.number(),
    metadata: v.optional(v.any()),
  },
  returns: v.id('workflowProcessingRecords'),
  handler: async (ctx, args) => {
    return await WorkflowProcessingRecordsModel.recordProcessed(ctx, args);
  },
});

/**
 * Get a processing record by ID.
 */
export const getProcessingRecordById = internalQuery({
  args: {
    processingRecordId: v.id('workflowProcessingRecords'),
  },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.processingRecordId);
  },
});
