import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';
import * as AuditLogHelpers from './helpers';
import { listAuditLogsPaginated as listAuditLogsPaginatedHelper } from './list_audit_logs_paginated';
import { auditLogFilterValidator, auditLogItemValidator } from './validators';

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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await getOrganizationMember(ctx, args.organizationId, authUser);

    return await AuditLogHelpers.listAuditLogs(ctx, {
      organizationId: args.organizationId,
      filter: args.filter,
      limit: args.limit,
      cursor: args.cursor,
    });
  },
});

export const listAuditLogsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
    category: v.optional(v.string()),
    resourceType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await getOrganizationMember(ctx, args.organizationId, authUser);

    return await listAuditLogsPaginatedHelper(ctx, args);
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await getOrganizationMember(ctx, args.organizationId, authUser);

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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await getOrganizationMember(ctx, args.organizationId, authUser);

    return await AuditLogHelpers.getActivitySummary(ctx, {
      organizationId: args.organizationId,
      startDate: args.startDate,
      endDate: args.endDate,
    });
  },
});
