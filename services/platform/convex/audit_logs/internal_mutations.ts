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

/**
 * Hard-delete audit-log rows older than `olderThanTimestamp`.
 *
 * Phase 9 — chain integrity:
 *   The audit_logs table maintains a SHA-256 chain via
 *   `previousHash`/`integrityHash` (audit_logs/helpers.ts). Hard-deleting
 *   the chain prefix breaks `verify_integrity.ts` for every retained
 *   successor: the oldest retained row's `previousHash` references a
 *   row that no longer exists. To preserve detectability across the
 *   archive boundary, this mutation writes a row to
 *   `auditLogCheckpoints` capturing the last deleted row's
 *   `integrityHash` and the count + max timestamp of deleted rows.
 *   `verify_integrity.ts` walks checkpoint→checkpoint to re-anchor the
 *   chain after a retention cut.
 *
 * Was named `archiveOldLogs` despite hard-deleting; renamed for honesty.
 * The legacy export name is re-exported below for backward compat with
 * any external scheduler-config that still references it.
 */
export const deleteOldLogs = internalMutation({
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
    let lastDeletedHash = '';
    let maxDeletedTimestamp = 0;

    for await (const log of ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_timestamp', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('asc')) {
      if (log.timestamp >= args.olderThanTimestamp) {
        break;
      }

      // Track the chain head we're deleting so the checkpoint can
      // anchor the retained chain.
      if (log.integrityHash) {
        lastDeletedHash = log.integrityHash;
      }
      if (log.timestamp > maxDeletedTimestamp) {
        maxDeletedTimestamp = log.timestamp;
      }

      await ctx.db.delete(log._id);
      deletedCount++;

      if (deletedCount >= batchSize) {
        break;
      }
    }

    if (deletedCount > 0) {
      // Look up the first retained row's previousHash so verifiers can
      // re-anchor the chain at this checkpoint.
      const firstRetained = await ctx.db
        .query('auditLogs')
        .withIndex('by_organizationId_and_timestamp', (q) =>
          q.eq('organizationId', args.organizationId),
        )
        .order('asc')
        .first();

      await ctx.db.insert('auditLogCheckpoints', {
        organizationId: args.organizationId,
        lastDeletedHash,
        firstRetainedPreviousHash: firstRetained?.previousHash,
        maxDeletedTimestamp,
        deletedCount,
        // signature: deferred until deploy-key signing lands.
        createdAt: Date.now(),
      });

      await AuditLogHelpers.createAuditLog(ctx, {
        organizationId: args.organizationId,
        actorId: 'system',
        actorType: 'system',
        action: 'audit_log.retention_deleted',
        category: 'admin',
        resourceType: 'audit_log_archive',
        status: 'success',
        metadata: {
          deletedCount,
          olderThanTimestamp: args.olderThanTimestamp,
          checkpointHash: lastDeletedHash,
        },
      });
    }

    return {
      deletedCount,
      hasMore: deletedCount >= batchSize,
    };
  },
});

/**
 * @deprecated — renamed to `deleteOldLogs`. Re-exported so callers
 * registered with the cron scheduler under the old name keep working
 * during the rename window.
 */
export const archiveOldLogs = deleteOldLogs;
