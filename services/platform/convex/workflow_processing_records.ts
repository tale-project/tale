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
  v.literal('approvals'),
  v.literal('onedriveSyncConfigs'),
  v.literal('websitePages'),
  v.literal('exampleMessages'),
);

/** Find and claim a single unprocessed record using by_organizationId index. */
export const findUnprocessed = internalMutation({
  args: {
    organizationId: v.string(),
    tableName: tableNameValidator,
    wfDefinitionId: v.string(),
    backoffHours: v.number(),
  },
  returns: v.object({ document: v.union(v.any(), v.null()) }),
  handler: async (ctx, args) =>
    WorkflowProcessingRecordsModel.findUnprocessed(ctx, args),
});

/** Find and claim a single unprocessed open conversation with inbound message. */
export const findUnprocessedOpenConversation = internalMutation({
  args: {
    organizationId: v.string(),
    wfDefinitionId: v.string(),
    backoffHours: v.number(),
  },
  returns: v.object({ conversation: v.union(v.any(), v.null()) }),
  handler: async (ctx, args) =>
    WorkflowProcessingRecordsModel.findUnprocessedOpenConversation(ctx, args),
});

/** Find and claim a single product recommendation approval by status. */
export const findProductRecommendationByStatus = internalMutation({
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
  returns: v.object({ approval: v.union(v.any(), v.null()) }),
  handler: async (ctx, args) =>
    WorkflowProcessingRecordsModel.findProductRecommendationByStatus(ctx, args),
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
