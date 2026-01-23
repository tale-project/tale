import { v } from 'convex/values';
import { query } from '../_generated/server';
import { authComponent } from '../auth';
import * as AuditLogHelpers from './helpers';
import {
  auditLogFilterValidator,
  auditLogItemValidator,
} from './validators';

export const listAuditLogs = query({
  args: {
    organizationId: v.string(),
    filter: v.optional(auditLogFilterValidator),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    logs: v.array(auditLogItemValidator),
    nextCursor: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await AuditLogHelpers.listAuditLogs(ctx, {
      organizationId: args.organizationId,
      filter: args.filter,
      limit: args.limit,
      cursor: args.cursor,
    });
  },
});

export const getResourceAuditTrail = query({
  args: {
    organizationId: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(auditLogItemValidator),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await AuditLogHelpers.getResourceAuditTrail(ctx, {
      organizationId: args.organizationId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      limit: args.limit,
    });
  },
});

export const getActivitySummary = query({
  args: {
    organizationId: v.string(),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  returns: v.object({
    totalActions: v.number(),
    successCount: v.number(),
    failureCount: v.number(),
    deniedCount: v.number(),
    byCategory: v.record(v.string(), v.number()),
    byResourceType: v.record(v.string(), v.number()),
    topActors: v.array(
      v.object({
        actorId: v.string(),
        actorEmail: v.optional(v.string()),
        count: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await AuditLogHelpers.getActivitySummary(ctx, {
      organizationId: args.organizationId,
      startDate: args.startDate,
      endDate: args.endDate,
    });
  },
});
