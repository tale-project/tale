/**
 * Internal queries for audit logs.
 *
 * Used by internal actions (e.g., export) that need to read audit logs
 * without user-facing auth checks.
 */

import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalQuery } from '../_generated/server';
import { isAdmin } from '../lib/rls/helpers/role_helpers';

const MAX_EXPORT_ROWS = 10_000;

export const listLogsForExport = internalQuery({
  args: {
    organizationId: v.string(),
    filter: v.optional(
      v.object({
        category: v.optional(v.string()),
        actorId: v.optional(v.string()),
        resourceType: v.optional(v.string()),
        status: v.optional(v.string()),
        startDate: v.optional(v.number()),
        endDate: v.optional(v.number()),
        search: v.optional(v.string()),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const filter = args.filter ?? {};
    const logs: Record<string, unknown>[] = [];

    for await (const log of ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_timestamp', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')) {
      if (filter.endDate && log.timestamp > filter.endDate) {
        continue;
      }
      if (filter.startDate && log.timestamp < filter.startDate) {
        break;
      }
      if (filter.category && log.category !== filter.category) {
        continue;
      }
      if (filter.actorId && log.actorId !== filter.actorId) {
        continue;
      }
      if (filter.resourceType && log.resourceType !== filter.resourceType) {
        continue;
      }
      if (filter.status && log.status !== filter.status) {
        continue;
      }
      if (filter.search) {
        const s = filter.search.toLowerCase();
        const matches =
          log.action.toLowerCase().includes(s) ||
          log.resourceType.toLowerCase().includes(s) ||
          log.resourceName?.toLowerCase().includes(s) ||
          log.actorEmail?.toLowerCase().includes(s);
        if (!matches) {
          continue;
        }
      }

      logs.push(log);
      if (logs.length >= MAX_EXPORT_ROWS) {
        break;
      }
    }

    return logs;
  },
});

export const getAuditRetentionConfig = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('policyType', 'audit_retention'),
      )
      .first();
  },
});

export const verifyAdminAccess = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'organizationId', value: args.organizationId, operator: 'eq' },
        { field: 'userId', value: args.userId, operator: 'eq' },
      ],
    });

    const member = result?.page?.[0];
    if (!member || !isAdmin(member.role)) {
      return null;
    }

    return member;
  },
});
