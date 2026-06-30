import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import { query } from '../_generated/server';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import type { OrganizationMember } from '../lib/rls/types';
import * as AuditLogHelpers from './helpers';
import { listAuditLogsPaginated as listAuditLogsPaginatedHelper } from './list_audit_logs_paginated';
import { auditLogFilterValidator, auditLogItemValidator } from './validators';

/**
 * Audit-log reads are admin/owner-only (#1505): the log records every
 * member's actions, so non-admins reading it would leak other users'
 * activity. Mirrors the RLS matrix (`access_control.ts`) and the
 * admin-only `orgSettings` UI gate.
 */
export function assertAuditLogReadAccess(member: OrganizationMember): void {
  if (!isAdmin(member.role)) {
    throw new ConvexError({
      code: 'FORBIDDEN',
      message: 'Only admins can read audit logs',
    });
  }
}

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
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
    assertAuditLogReadAccess(member);

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
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
    assertAuditLogReadAccess(member);

    return await listAuditLogsPaginatedHelper(ctx, args);
  },
});

/**
 * Errors-only view of the audit trail (status `failure` or `denied`),
 * newest first. Backs the "Error logs" tab; same admin gate as the
 * full audit log.
 */
export const listErrorLogsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
    assertAuditLogReadAccess(member);

    return await listAuditLogsPaginatedHelper(ctx, {
      ...args,
      onlyErrors: true,
    });
  },
});

export const getActivitySummary = query({
  args: {
    organizationId: v.string(),
    // Window size instead of epoch bounds: callers pass a stable arg
    // (7/30/90), so the client query cache keys don't churn on every
    // mount the way a `Date.now()`-derived startDate would.
    periodDays: v.optional(v.number()),
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
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
    assertAuditLogReadAccess(member);

    const periodDays = args.periodDays ?? 7;
    return await AuditLogHelpers.getActivitySummary(ctx, {
      organizationId: args.organizationId,
      startDate: Date.now() - periodDays * 24 * 60 * 60 * 1000,
    });
  },
});
