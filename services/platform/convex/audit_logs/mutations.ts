import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import * as AuditLogHelpers from './helpers';
import {
  auditLogActorTypeValidator,
  auditLogCategoryValidator,
  auditLogStatusValidator,
} from './validators';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const createAuditLog = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
    actorRole: v.optional(v.string()),
    actorType: auditLogActorTypeValidator,
    action: v.string(),
    category: auditLogCategoryValidator,
    resourceType: v.string(),
    resourceId: v.optional(v.string()),
    resourceName: v.optional(v.string()),
    previousState: v.optional(jsonRecordValidator),
    newState: v.optional(jsonRecordValidator),
    changedFields: v.optional(v.array(v.string())),
    sessionId: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    requestId: v.optional(v.string()),
    status: auditLogStatusValidator,
    errorMessage: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    return await AuditLogHelpers.createAuditLog(ctx, args);
  },
});

export const archiveOldLogs = internalMutation({
  args: {
    organizationId: v.string(),
    olderThanTimestamp: v.number(),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deletedCount: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 100;
    let deletedCount = 0;

    for await (const log of ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_timestamp', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('asc')) {
      if (log.timestamp >= args.olderThanTimestamp) {
        break;
      }

      await ctx.db.delete(log._id);
      deletedCount++;

      if (deletedCount >= batchSize) {
        break;
      }
    }

    return { deletedCount, hasMore: deletedCount >= batchSize };
  },
});

const RETENTION_DAYS = 90;
const BATCH_SIZE = 500;

export const runRetentionCleanup = internalMutation({
  args: {},
  returns: v.object({
    deletedCount: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    const cutoffTimestamp = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let totalDeleted = 0;

    for await (const log of ctx.db
      .query('auditLogs')
      .withIndex('by_timestamp')
      .order('asc')) {
      if (log.timestamp >= cutoffTimestamp) {
        break;
      }

      await ctx.db.delete(log._id);
      totalDeleted++;

      if (totalDeleted >= BATCH_SIZE) {
        break;
      }
    }

    return { deletedCount: totalDeleted, hasMore: totalDeleted >= BATCH_SIZE };
  },
});
