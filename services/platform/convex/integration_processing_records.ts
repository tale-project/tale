/**
 * Integration Processing Records API
 *
 * Internal mutations/queries for tracking processing status of external data sources.
 * These work with the existing workflowProcessingRecords table but support
 * extended table names in the format `integration:<integrationName>:<sourceIdentifier>`.
 */

import { internalQuery, internalMutation } from './_generated/server';
import { v } from 'convex/values';

/**
 * Check if an integration record has been processed since the cutoff timestamp
 */
export const isRecordProcessed = internalQuery({
  args: {
    tableName: v.string(), // Accepts integration:* pattern
    recordId: v.string(),
    wfDefinitionId: v.string(),
    cutoffTimestamp: v.string(), // ISO date string
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { tableName, recordId, wfDefinitionId, cutoffTimestamp } = args;

    const cutoffMs = new Date(cutoffTimestamp).getTime();

    const processedRecord = await ctx.db
      .query('workflowProcessingRecords')
      .withIndex('by_record', (q) =>
        q
          .eq('tableName', tableName)
          .eq('recordId', recordId)
          .eq('wfDefinitionId', wfDefinitionId),
      )
      .first();

    if (!processedRecord) {
      return false;
    }

    return processedRecord.processedAt >= cutoffMs;
  },
});

/**
 * Atomically check if a record can be claimed and claim it if available.
 *
 * This combines the "check if processed" and "claim" operations into a single
 * atomic mutation to prevent race conditions where multiple workflow executions
 * might claim the same record.
 *
 * @returns The processing record ID if claimed successfully, null if already processed
 */
export const checkAndClaimRecord = internalMutation({
  args: {
    organizationId: v.string(),
    tableName: v.string(),
    recordId: v.string(),
    wfDefinitionId: v.string(),
    recordCreationTime: v.number(),
    cutoffTimestamp: v.string(),
    metadata: v.optional(v.any()),
  },
  returns: v.union(v.id('workflowProcessingRecords'), v.null()),
  handler: async (ctx, args) => {
    const {
      organizationId,
      tableName,
      recordId,
      wfDefinitionId,
      recordCreationTime,
      cutoffTimestamp,
      metadata,
    } = args;

    const now = Date.now();
    const cutoffMs = new Date(cutoffTimestamp).getTime();

    // Check if this record already has a processing entry
    const existing = await ctx.db
      .query('workflowProcessingRecords')
      .withIndex('by_record', (q) =>
        q
          .eq('tableName', tableName)
          .eq('recordId', recordId)
          .eq('wfDefinitionId', wfDefinitionId),
      )
      .first();

    if (existing) {
      // Record exists - check if it's still within the backoff period
      if (existing.processedAt >= cutoffMs) {
        // Already processed recently, cannot claim
        return null;
      }

      // Outside backoff period, can reclaim
      await ctx.db.patch(existing._id, {
        processedAt: now,
        status: 'in_progress',
        metadata,
      });
      return existing._id;
    }

    // No existing record, create new claim
    return await ctx.db.insert('workflowProcessingRecords', {
      organizationId,
      tableName,
      recordId,
      wfDefinitionId,
      recordCreationTime,
      processedAt: now,
      status: 'in_progress',
      metadata,
    });
  },
});

/**
 * Claim an integration record for processing (mark as in_progress)
 *
 * @deprecated Use checkAndClaimRecord for atomic check-and-claim operations
 */
export const recordClaimed = internalMutation({
  args: {
    organizationId: v.string(),
    tableName: v.string(), // Accepts integration:* pattern
    recordId: v.string(),
    wfDefinitionId: v.string(),
    recordCreationTime: v.number(),
    metadata: v.optional(v.any()),
  },
  returns: v.id('workflowProcessingRecords'),
  handler: async (ctx, args) => {
    const {
      organizationId,
      tableName,
      recordId,
      wfDefinitionId,
      recordCreationTime,
      metadata,
    } = args;

    const now = Date.now();

    // Check if this record already has a processing entry
    const existing = await ctx.db
      .query('workflowProcessingRecords')
      .withIndex('by_record', (q) =>
        q
          .eq('tableName', tableName)
          .eq('recordId', recordId)
          .eq('wfDefinitionId', wfDefinitionId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        processedAt: now,
        status: 'in_progress',
        metadata,
      });
      return existing._id;
    }

    return await ctx.db.insert('workflowProcessingRecords', {
      organizationId,
      tableName,
      recordId,
      wfDefinitionId,
      recordCreationTime,
      processedAt: now,
      status: 'in_progress',
      metadata,
    });
  },
});

/**
 * Mark an integration record as processed (completed)
 */
export const recordProcessed = internalMutation({
  args: {
    organizationId: v.string(),
    tableName: v.string(), // Accepts integration:* pattern
    recordId: v.string(),
    wfDefinitionId: v.string(),
    recordCreationTime: v.number(),
    metadata: v.optional(v.any()),
  },
  returns: v.id('workflowProcessingRecords'),
  handler: async (ctx, args) => {
    const {
      organizationId,
      tableName,
      recordId,
      wfDefinitionId,
      recordCreationTime,
      metadata,
    } = args;

    const now = Date.now();

    const existing = await ctx.db
      .query('workflowProcessingRecords')
      .withIndex('by_record', (q) =>
        q
          .eq('tableName', tableName)
          .eq('recordId', recordId)
          .eq('wfDefinitionId', wfDefinitionId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        processedAt: now,
        status: 'completed',
        metadata,
      });
      return existing._id;
    }

    return await ctx.db.insert('workflowProcessingRecords', {
      organizationId,
      tableName,
      recordId,
      wfDefinitionId,
      recordCreationTime,
      processedAt: now,
      status: 'completed',
      metadata,
    });
  },
});

/**
 * Get a processing record by ID
 */
export const getProcessingRecordById = internalQuery({
  args: {
    processingRecordId: v.id('workflowProcessingRecords'),
  },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => ctx.db.get(args.processingRecordId),
});

/**
 * Get the latest processed record for an integration source
 * Used to retrieve the resume point for incremental processing
 */
export const getLatestProcessedForIntegration = internalQuery({
  args: {
    tableName: v.string(), // integration:* pattern
    wfDefinitionId: v.string(),
  },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    const { tableName, wfDefinitionId } = args;

    // Get the most recently processed record for this integration source
    // Use completed status for reliable resume points
    return ctx.db
      .query('workflowProcessingRecords')
      .withIndex('by_org_table_wfDefinition_processedAt')
      .filter((q) =>
        q.and(
          q.eq(q.field('tableName'), tableName),
          q.eq(q.field('wfDefinitionId'), wfDefinitionId),
          q.eq(q.field('status'), 'completed'),
        ),
      )
      .order('desc')
      .first();
  },
});
