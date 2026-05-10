/**
 * Public read-side for the GDPR Art 17 erasure receipts UI. Mutations
 * live in `erasure.ts`; this module is read-only and admin-gated. The
 * receipts themselves never include erased PII content — only aggregate
 * counts plus the subject identifier and reason narrative the admin
 * supplied at request time.
 *
 * `listErasureRequests` powers the table view in
 * `app/features/settings/governance/data-subject-requests/`. It
 * supports a multi-select status filter and cursor pagination via
 * Convex's `paginationOpts`.
 *
 * `getErasureRequest` powers the detail drawer. It returns the row plus
 * the linked audit-log timeline (every `gdpr_erasure_*` row whose
 * `resourceId` matches the subject's userId) so the receipt is
 * self-contained for regulator hand-off.
 */

import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { query } from '../_generated/server';
import { getResourceAuditTrail } from '../audit_logs/helpers';
import { auditLogItemValidator } from '../audit_logs/validators';
import { authComponent } from '../auth';
import { getUserNamesBatch } from '../documents/get_user_names_batch';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { ERASURE_REASON_CODES, ERASURE_STATUSES } from './erasure_constants';

const erasureStatusValidator = v.union(
  ...ERASURE_STATUSES.map((s) => v.literal(s)),
);

const erasureReasonCodeValidator = v.union(
  ...ERASURE_REASON_CODES.map((c) => v.literal(c)),
);

async function requireAdmin(
  ctx: QueryCtx,
  organizationId: string,
): Promise<{ userId: string; role: string }> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new Error('Unauthenticated');
  }
  const member = await getOrganizationMember(ctx, organizationId, {
    userId: String(authUser._id),
    email: authUser.email ?? '',
    name: authUser.name ?? undefined,
  });
  if (!isAdmin(member.role)) {
    throw new Error('Admin role required.');
  }
  return { userId: String(authUser._id), role: member.role };
}

async function shapeSummaries(
  ctx: QueryCtx,
  rows: Doc<'gdprErasureRequests'>[],
) {
  const userIds = new Set<string>();
  for (const row of rows) {
    if (row.targetUserId) userIds.add(row.targetUserId);
    if (row.requestedBy) userIds.add(row.requestedBy);
    if (row.extensionGrantedBy) userIds.add(row.extensionGrantedBy);
  }
  const nameMap = await getUserNamesBatch(ctx, [...userIds]);

  return rows.map((row) => ({
    _id: row._id,
    organizationId: row.organizationId,
    targetUserId: row.targetUserId,
    targetUserName: nameMap.get(row.targetUserId) ?? row.targetUserId,
    reason: row.reason,
    reasonCode: row.reasonCode,
    requestedBy: row.requestedBy,
    requestedByName: nameMap.get(row.requestedBy) ?? row.requestedBy,
    requestedAt: row.requestedAt,
    slaDeadlineAt: row.slaDeadlineAt,
    status: row.status,
    threadsTargeted: row.threadsTargeted?.length,
    threadsErased: row.threadsErased,
    ragDocumentsRemoved: row.ragDocumentsRemoved,
    documentsErased: row.documentsErased,
    documentsSkippedByHold: row.documentsSkippedByHold,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    extensionGrantedAt: row.extensionGrantedAt,
    extensionGrantedBy: row.extensionGrantedBy,
    extensionGrantedByName: row.extensionGrantedBy
      ? (nameMap.get(row.extensionGrantedBy) ?? row.extensionGrantedBy)
      : undefined,
    extensionReason: row.extensionReason,
    extensionDeadlineAt: row.extensionDeadlineAt,
  }));
}

/**
 * Paginated list of erasure requests. Status filter is multi-select; an
 * empty / undefined `statuses` returns every request for the org. Newest
 * first.
 *
 * The `by_organizationId_status` index is exact-match per status, which
 * makes a multi-status filter awkward — we use the broader
 * `by_organizationId_status` for single-status filters and otherwise
 * fall back to scanning the org's rows and filtering in-memory. The
 * trade-off is acceptable: erasure rows are write-rarely (one per
 * subject request, not per row of subject data) so even busy orgs see
 * tens to low-hundreds of rows total.
 */
export const listErasureRequests = query({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
    statuses: v.optional(v.array(erasureStatusValidator)),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.organizationId);

    const statuses = args.statuses;
    const singleStatus =
      statuses && statuses.length === 1 ? statuses[0] : undefined;

    if (singleStatus) {
      // Indexed path: hits the (org, status) compound directly.
      const result = await ctx.db
        .query('gdprErasureRequests')
        .withIndex('by_organizationId_status', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('status', singleStatus),
        )
        .order('desc')
        .paginate(args.paginationOpts);
      const page = await shapeSummaries(ctx, result.page);
      return {
        page,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }

    // Multi-status (or unfiltered) path. We must paginate over the
    // org-scoped collection and filter post-fetch; statuses-set membership
    // is the discriminator. With a single status we'd take the indexed
    // branch above, so this only fires for genuinely multi-valued filters.
    const set = statuses ? new Set<string>(statuses) : null;
    const result = await ctx.db
      .query('gdprErasureRequests')
      .withIndex('by_organizationId_status', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')
      .paginate(args.paginationOpts);
    const filtered = set
      ? result.page.filter((r) => set.has(r.status))
      : result.page;
    const page = await shapeSummaries(ctx, filtered);
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Detail view for a single erasure receipt. Returns the full row + the
 * audit-log chain rows scoped to the subject so the drawer can render a
 * timeline (request → blocked / extended / executed / retried / etc.).
 *
 * Audit entries are filtered to the canonical subject scope:
 * `resourceType: 'user'` AND `resourceId === targetUserId`. The
 * watchdog and cascade-exhausted entries also ride this scope, so the
 * timeline picks up system-actor events alongside user-actor ones.
 */
const erasureRequestDetailValidator = v.object({
  request: v.object({
    _id: v.id('gdprErasureRequests'),
    organizationId: v.string(),
    targetUserId: v.string(),
    targetUserName: v.string(),
    reason: v.string(),
    reasonCode: v.optional(erasureReasonCodeValidator),
    requestedBy: v.string(),
    requestedByName: v.string(),
    requestedAt: v.number(),
    slaDeadlineAt: v.number(),
    status: erasureStatusValidator,
    threadsTargeted: v.optional(v.array(v.string())),
    threadsErased: v.optional(v.number()),
    threadsBlockedByHold: v.optional(v.array(v.string())),
    documentsBlockedByHold: v.optional(v.array(v.string())),
    ragDocumentsRemoved: v.optional(v.number()),
    documentsErased: v.optional(v.number()),
    documentsSkippedByHold: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    extensionGrantedAt: v.optional(v.number()),
    extensionGrantedBy: v.optional(v.string()),
    extensionGrantedByName: v.optional(v.string()),
    extensionReason: v.optional(v.string()),
    extensionDeadlineAt: v.optional(v.number()),
  }),
  auditEntries: v.array(auditLogItemValidator),
});

export const getErasureRequest = query({
  args: {
    requestId: v.id('gdprErasureRequests'),
  },
  returns: erasureRequestDetailValidator,
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row) {
      throw new Error('Erasure request does not exist.');
    }
    await requireAdmin(ctx, row.organizationId);

    const userIds = new Set<string>([row.targetUserId, row.requestedBy]);
    if (row.extensionGrantedBy) userIds.add(row.extensionGrantedBy);
    const nameMap = await getUserNamesBatch(ctx, [...userIds]);

    const auditEntries = await getResourceAuditTrail(ctx, {
      organizationId: row.organizationId,
      resourceType: 'user',
      resourceId: row.targetUserId,
    });
    const erasureAuditEntries = auditEntries.filter((e) =>
      e.action.startsWith('gdpr_erasure'),
    );

    return {
      request: {
        _id: row._id,
        organizationId: row.organizationId,
        targetUserId: row.targetUserId,
        targetUserName: nameMap.get(row.targetUserId) ?? row.targetUserId,
        reason: row.reason,
        reasonCode: row.reasonCode,
        requestedBy: row.requestedBy,
        requestedByName: nameMap.get(row.requestedBy) ?? row.requestedBy,
        requestedAt: row.requestedAt,
        slaDeadlineAt: row.slaDeadlineAt,
        status: row.status,
        threadsTargeted: row.threadsTargeted,
        threadsErased: row.threadsErased,
        threadsBlockedByHold: row.threadsBlockedByHold,
        documentsBlockedByHold: row.documentsBlockedByHold,
        ragDocumentsRemoved: row.ragDocumentsRemoved,
        documentsErased: row.documentsErased,
        documentsSkippedByHold: row.documentsSkippedByHold,
        errorMessage: row.errorMessage,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        extensionGrantedAt: row.extensionGrantedAt,
        extensionGrantedBy: row.extensionGrantedBy,
        extensionGrantedByName: row.extensionGrantedBy
          ? (nameMap.get(row.extensionGrantedBy) ?? row.extensionGrantedBy)
          : undefined,
        extensionReason: row.extensionReason,
        extensionDeadlineAt: row.extensionDeadlineAt,
      },
      auditEntries: erasureAuditEntries,
    };
  },
});
