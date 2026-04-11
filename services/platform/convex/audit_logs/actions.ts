/**
 * Public actions for audit logs.
 *
 * These are user-facing action endpoints with proper auth checks.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';

export const requestExport = action({
  args: {
    organizationId: v.string(),
    format: v.union(v.literal('csv'), v.literal('json')),
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
  returns: v.object({
    storageId: v.string(),
    fileName: v.string(),
    url: v.union(v.string(), v.null()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ storageId: string; fileName: string; url: string | null }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    // Admin-only: verify membership and role via internal query
    const member = await ctx.runQuery(
      internal.audit_logs.internal_queries.verifyAdminAccess,
      {
        organizationId: args.organizationId,
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      },
    );

    if (!member) {
      throw new Error('Only admins can export audit logs');
    }

    const result: { storageId: string; fileName: string } = await ctx.runAction(
      internal.audit_logs.export_audit_logs.exportAuditLogs,
      {
        organizationId: args.organizationId,
        format: args.format,
        filter: args.filter,
      },
    );

    const url = await ctx.storage.getUrl(result.storageId);

    return {
      storageId: result.storageId,
      fileName: result.fileName,
      url,
    };
  },
});
