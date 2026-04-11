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

const DEFAULT_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 365;
const BATCH_SIZE = 500;

export const runRetentionCleanup = internalMutation({
  args: {},
  returns: v.object({
    deletedCount: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    let totalDeleted = 0;

    // Collect distinct organization IDs from old logs
    const orgRetentionMap = new Map<string, number>();

    for await (const log of ctx.db
      .query('auditLogs')
      .withIndex('by_timestamp')
      .order('asc')) {
      const orgId = log.organizationId;

      if (!orgRetentionMap.has(orgId)) {
        // Look up per-org retention config
        const policy = await ctx.db
          .query('governancePolicies')
          .withIndex('by_org_policyType', (q) =>
            q.eq('organizationId', orgId).eq('policyType', 'audit_retention'),
          )
          .first();

        let retentionDays = DEFAULT_RETENTION_DAYS;
        if (
          policy?.config &&
          typeof policy.config === 'object' &&
          'retentionDays' in policy.config
        ) {
          const days = policy.config.retentionDays;
          if (
            typeof days === 'number' &&
            days >= MIN_RETENTION_DAYS &&
            days <= MAX_RETENTION_DAYS
          ) {
            retentionDays = days;
          }
        }
        orgRetentionMap.set(orgId, retentionDays);
      }

      const retentionDays =
        orgRetentionMap.get(orgId) ?? DEFAULT_RETENTION_DAYS;
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

      if (log.timestamp >= cutoff) {
        continue;
      }

      await ctx.db.delete(log._id);
      totalDeleted++;

      if (totalDeleted >= BATCH_SIZE) {
        break;
      }
    }

    // Meta-audit: log the retention cleanup action
    if (totalDeleted > 0) {
      await AuditLogHelpers.createAuditLog(ctx, {
        organizationId: 'system',
        actorId: 'system',
        actorType: 'system',
        action: 'audit_log.retention_cleanup',
        category: 'admin',
        resourceType: 'audit_log_retention',
        status: 'success',
        metadata: {
          deletedCount: totalDeleted,
        },
      });
    }

    return { deletedCount: totalDeleted, hasMore: totalDeleted >= BATCH_SIZE };
  },
});
