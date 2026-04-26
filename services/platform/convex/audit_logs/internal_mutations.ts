import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import * as AuditLogHelpers from './helpers';
import {
  auditLogActorTypeValidator,
  auditLogCategoryValidator,
  auditLogStatusValidator,
} from './validators';

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

/**
 * Internal mutation wrapper around `logJoinedOrganization` so Better Auth
 * hooks (which run in an HTTP ActionCtx, not a MutationCtx) can write the
 * audit row via `ctx.runMutation`.
 */
export const logJoinedOrganization = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    userEmail: v.string(),
    userRole: v.string(),
  },
  handler: async (ctx, args) => {
    return await AuditLogHelpers.logJoinedOrganization(ctx, args);
  },
});

export const archiveOldLogs = internalMutation({
  args: {
    organizationId: v.string(),
    olderThanTimestamp: v.number(),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    archivedCount: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 100;
    let archivedCount = 0;

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
      archivedCount++;

      if (archivedCount >= batchSize) {
        break;
      }
    }

    if (archivedCount > 0) {
      await AuditLogHelpers.createAuditLog(ctx, {
        organizationId: args.organizationId,
        actorId: 'system',
        actorType: 'system',
        action: 'audit_log.archived',
        category: 'admin',
        resourceType: 'audit_log_archive',
        status: 'success',
        metadata: {
          archivedCount,
          olderThanTimestamp: args.olderThanTimestamp,
        },
      });
    }

    return {
      archivedCount,
      hasMore: archivedCount >= batchSize,
    };
  },
});
