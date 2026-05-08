/**
 * Public legal-hold queries for the operator UI.
 *
 * Mutations live in `legal_hold.ts`. This module adds the read-side that
 * the UI in `app/features/settings/governance/legal-hold/` consumes:
 *
 *   - `listLegalHolds` / `listLegalMatters` / release-request lists are
 *     admin-only and use `getOrganizationMember` + `isAdmin` (mirrors
 *     `governance/queries.ts`).
 *   - `getLegalHoldByTarget` and `listActiveHoldTargetIds` are
 *     member-readable so the UI can render a small "held" badge in chat
 *     sidebars / document grids without leaking the placement reason or
 *     matter linkage. Non-admin callers get a stripped projection that
 *     is enough to draw a lock icon and nothing else.
 */

import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { getNumber, getString, isRecord } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import { authComponent } from '../auth';
import { getUserNamesBatch } from '../documents/get_user_names_batch';
import { getOrganizationMember } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';

const TARGET_TYPES = [
  'thread',
  'document',
  'execution',
  'userMembership',
  'org',
] as const;

const targetTypeValidator = v.union(...TARGET_TYPES.map((t) => v.literal(t)));

const releaseStatusValidator = v.union(
  v.literal('pending'),
  v.literal('approved'),
  v.literal('rejected'),
  v.literal('effected'),
);

const holdStatusValidator = v.union(
  v.literal('active'),
  v.literal('released'),
  v.literal('all'),
);

const matterStatusValidator = v.union(
  v.literal('open'),
  v.literal('closed'),
  v.literal('all'),
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

async function requireMember(
  ctx: QueryCtx,
  organizationId: string,
): Promise<{ userId: string; role: string; isAdmin: boolean }> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new Error('Unauthenticated');
  }
  const member = await getOrganizationMember(ctx, organizationId, {
    userId: String(authUser._id),
    email: authUser.email ?? '',
    name: authUser.name ?? undefined,
  });
  return {
    userId: String(authUser._id),
    role: member.role,
    isAdmin: isAdmin(member.role),
  };
}

const holdItemValidator = v.object({
  _id: v.id('legalHolds'),
  organizationId: v.string(),
  targetType: targetTypeValidator,
  targetId: v.string(),
  /** Write-time snapshot of the target's human-readable label
   *  (email / title / slug). Falls back to `targetId` when the held
   *  entity has no natural label field. */
  targetLabel: v.string(),
  reason: v.string(),
  matterRef: v.optional(v.string()),
  matterName: v.optional(v.string()),
  placedBy: v.string(),
  placedByName: v.string(),
  placedAt: v.number(),
  releasedAt: v.optional(v.number()),
  releasedBy: v.optional(v.string()),
  releasedByName: v.optional(v.string()),
  releaseReason: v.optional(v.string()),
});

export const listLegalHolds = query({
  args: {
    organizationId: v.string(),
    status: v.optional(holdStatusValidator),
    targetType: v.optional(targetTypeValidator),
  },
  returns: v.array(holdItemValidator),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.organizationId);

    const status = args.status ?? 'active';

    const targetType = args.targetType;
    const rows: Doc<'legalHolds'>[] = targetType
      ? await ctx.db
          .query('legalHolds')
          .withIndex('by_organizationId_targetType', (q) =>
            q
              .eq('organizationId', args.organizationId)
              .eq('targetType', targetType),
          )
          .collect()
      : await ctx.db
          .query('legalHolds')
          .withIndex('by_organizationId', (q) =>
            q.eq('organizationId', args.organizationId),
          )
          .collect();

    const filtered = rows.filter((row) => {
      if (status === 'active') return row.releasedAt === undefined;
      if (status === 'released') return row.releasedAt !== undefined;
      return true;
    });

    const userIds = new Set<string>();
    for (const row of filtered) {
      if (row.placedBy) userIds.add(row.placedBy);
      if (row.releasedBy) userIds.add(row.releasedBy);
    }
    const matterIds = new Set<string>();
    for (const row of filtered) {
      if (row.matterRef) matterIds.add(row.matterRef);
    }

    const [nameMap, matterNames] = await Promise.all([
      getUserNamesBatch(ctx, [...userIds]),
      resolveMatterNames(ctx, args.organizationId, [...matterIds]),
    ]);

    return filtered.map((row) => ({
      _id: row._id,
      organizationId: row.organizationId,
      targetType: row.targetType,
      targetId: row.targetId,
      targetLabel: row.targetLabel,
      reason: row.reason,
      matterRef: row.matterRef,
      matterName: row.matterRef ? matterNames.get(row.matterRef) : undefined,
      placedBy: row.placedBy,
      placedByName: nameMap.get(row.placedBy) ?? row.placedBy,
      placedAt: row.placedAt,
      releasedAt: row.releasedAt,
      releasedBy: row.releasedBy,
      releasedByName: row.releasedBy
        ? (nameMap.get(row.releasedBy) ?? row.releasedBy)
        : undefined,
      releaseReason: row.releaseReason,
    }));
  },
});

async function resolveMatterNames(
  ctx: QueryCtx,
  organizationId: string,
  matterRefs: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (matterRefs.length === 0) return out;
  // matterRef is `String(matter._id)`. ctx.db.get throws on malformed
  // strings, so wrap each lookup; an unresolved ref just falls through
  // without a matter name.
  for (const ref of matterRefs) {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ref is a stringified Id<'legalMatters'> from a user-facing field; ctx.db.get throws on malformed input which we catch below
      const matter = await ctx.db.get(ref as Doc<'legalMatters'>['_id']);
      if (matter && matter.organizationId === organizationId) {
        out.set(ref, matter.name);
      }
    } catch (err) {
      console.warn(
        `[legal_hold_queries] matter lookup failed for ref='${ref}': ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return out;
}

const matterItemValidator = v.object({
  _id: v.id('legalMatters'),
  organizationId: v.string(),
  name: v.string(),
  caseNumber: v.optional(v.string()),
  description: v.optional(v.string()),
  status: v.union(v.literal('open'), v.literal('closed')),
  createdBy: v.string(),
  createdByName: v.string(),
  createdAt: v.number(),
  closedBy: v.optional(v.string()),
  closedByName: v.optional(v.string()),
  closedAt: v.optional(v.number()),
  linkedActiveHolds: v.number(),
});

export const listLegalMatters = query({
  args: {
    organizationId: v.string(),
    status: v.optional(matterStatusValidator),
  },
  returns: v.array(matterItemValidator),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.organizationId);

    const status = args.status ?? 'all';

    const matters: Doc<'legalMatters'>[] =
      status === 'all'
        ? await ctx.db
            .query('legalMatters')
            .withIndex('by_organizationId', (q) =>
              q.eq('organizationId', args.organizationId),
            )
            .collect()
        : await ctx.db
            .query('legalMatters')
            .withIndex('by_organizationId_status', (q) =>
              q.eq('organizationId', args.organizationId).eq('status', status),
            )
            .collect();

    const userIds = new Set<string>();
    for (const m of matters) {
      if (m.createdBy) userIds.add(m.createdBy);
      if (m.closedBy) userIds.add(m.closedBy);
    }
    const nameMap = await getUserNamesBatch(ctx, [...userIds]);

    const result: Array<{
      _id: Doc<'legalMatters'>['_id'];
      organizationId: string;
      name: string;
      caseNumber?: string;
      description?: string;
      status: 'open' | 'closed';
      createdBy: string;
      createdByName: string;
      createdAt: number;
      closedBy?: string;
      closedByName?: string;
      closedAt?: number;
      linkedActiveHolds: number;
    }> = [];

    for (const m of matters) {
      const linked = await ctx.db
        .query('legalHolds')
        .withIndex('by_organizationId_matterRef', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('matterRef', String(m._id)),
        )
        .collect();
      const linkedActiveHolds = linked.filter(
        (h) => h.releasedAt === undefined,
      ).length;

      result.push({
        _id: m._id,
        organizationId: m.organizationId,
        name: m.name,
        caseNumber: m.caseNumber,
        description: m.description,
        status: m.status,
        createdBy: m.createdBy,
        createdByName: nameMap.get(m.createdBy) ?? m.createdBy,
        createdAt: m.createdAt,
        closedBy: m.closedBy,
        closedByName: m.closedBy
          ? (nameMap.get(m.closedBy) ?? m.closedBy)
          : undefined,
        closedAt: m.closedAt,
        linkedActiveHolds,
      });
    }
    return result;
  },
});

const releaseRequestItemValidator = v.object({
  _id: v.id('legalHoldReleaseRequests'),
  organizationId: v.string(),
  holdId: v.id('legalHolds'),
  // Resolved hold target so the UI doesn't need a second lookup.
  targetType: v.optional(targetTypeValidator),
  targetId: v.optional(v.string()),
  requestedBy: v.string(),
  requestedByName: v.string(),
  requestedAt: v.number(),
  reason: v.string(),
  status: releaseStatusValidator,
  approvedBy: v.optional(v.string()),
  approvedByName: v.optional(v.string()),
  approvedAt: v.optional(v.number()),
  effectiveAt: v.optional(v.number()),
  rejectedBy: v.optional(v.string()),
  rejectedByName: v.optional(v.string()),
  rejectedAt: v.optional(v.number()),
  rejectReason: v.optional(v.string()),
});

async function shapeReleaseRequests(
  ctx: QueryCtx,
  rows: Doc<'legalHoldReleaseRequests'>[],
) {
  const userIds = new Set<string>();
  const holdIds = new Set<Doc<'legalHolds'>['_id']>();
  for (const r of rows) {
    if (r.requestedBy) userIds.add(r.requestedBy);
    if (r.approvedBy) userIds.add(r.approvedBy);
    if (r.rejectedBy) userIds.add(r.rejectedBy);
    holdIds.add(r.holdId);
  }
  const nameMap = await getUserNamesBatch(ctx, [...userIds]);
  const holdMap = new Map<
    string,
    { targetType: (typeof TARGET_TYPES)[number]; targetId: string }
  >();
  for (const id of holdIds) {
    const h = await ctx.db.get(id);
    if (h) {
      holdMap.set(String(id), {
        targetType: h.targetType,
        targetId: h.targetId,
      });
    }
  }

  return rows.map((r) => {
    const target = holdMap.get(String(r.holdId));
    return {
      _id: r._id,
      organizationId: r.organizationId,
      holdId: r.holdId,
      targetType: target?.targetType,
      targetId: target?.targetId,
      requestedBy: r.requestedBy,
      requestedByName: nameMap.get(r.requestedBy) ?? r.requestedBy,
      requestedAt: r.requestedAt,
      reason: r.reason,
      status: r.status,
      approvedBy: r.approvedBy,
      approvedByName: r.approvedBy
        ? (nameMap.get(r.approvedBy) ?? r.approvedBy)
        : undefined,
      approvedAt: r.approvedAt,
      effectiveAt: r.effectiveAt,
      rejectedBy: r.rejectedBy,
      rejectedByName: r.rejectedBy
        ? (nameMap.get(r.rejectedBy) ?? r.rejectedBy)
        : undefined,
      rejectedAt: r.rejectedAt,
      rejectReason: r.rejectReason,
    };
  });
}

/**
 * Non-paginated list scoped to one status. Used by the active sections
 * (Pending + Approved-awaiting-cooldown) where row counts are bounded
 * by org size and never warrant a paginator.
 */
export const listLegalHoldReleaseRequests = query({
  args: {
    organizationId: v.string(),
    status: releaseStatusValidator,
  },
  returns: v.array(releaseRequestItemValidator),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.organizationId);
    const rows = await ctx.db
      .query('legalHoldReleaseRequests')
      .withIndex('by_organizationId_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', args.status),
      )
      .order('desc')
      .collect();
    return shapeReleaseRequests(ctx, rows);
  },
});

/**
 * Paginated history view. Used by the "Release History" section which
 * filters by completed statuses (effected / rejected) and may grow over
 * time.
 */
export const listLegalHoldReleaseRequestsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
    status: releaseStatusValidator,
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.organizationId);
    const result = await ctx.db
      .query('legalHoldReleaseRequests')
      .withIndex('by_organizationId_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', args.status),
      )
      .order('desc')
      .paginate(args.paginationOpts);
    const page = await shapeReleaseRequests(ctx, result.page);
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

const heldByTargetValidator = v.union(
  v.null(),
  v.object({
    _id: v.id('legalHolds'),
    targetType: targetTypeValidator,
    targetId: v.string(),
    placedAt: v.number(),
    /**
     * 'admin' callers see reason/matter/placedBy. 'member' callers get
     * a stripped projection so the badge can render without leaking
     * potentially sensitive case names or attribution.
     */
    view: v.union(v.literal('admin'), v.literal('member')),
    /**
     * How this entity is held: 'direct' = a hold row directly references
     * this targetType+targetId; 'user_custodian' = the entity's author is
     * on a userMembership hold (cascade hit); 'org' = the whole org is on
     * a hold. Used by the UI to differentiate badge labels.
     */
    via: v.union(
      v.literal('direct'),
      v.literal('user_custodian'),
      v.literal('org'),
    ),
    reason: v.optional(v.string()),
    matterRef: v.optional(v.string()),
    matterName: v.optional(v.string()),
    placedBy: v.optional(v.string()),
    placedByName: v.optional(v.string()),
    hasPendingRelease: v.boolean(),
    hasApprovedRelease: v.boolean(),
    /** Set when an approved release request is awaiting cooldown. */
    effectiveAt: v.optional(v.number()),
  }),
);

/**
 * Resolve the "author" user-id for a thread or document, so the cascade
 * lookup can match the entity against active userMembership holds.
 * Returns `null` for entity types without user attribution (execution),
 * or when the entity is not found.
 */
async function resolveEntityAuthor(
  ctx: QueryCtx,
  organizationId: string,
  targetType: (typeof TARGET_TYPES)[number],
  targetId: string,
): Promise<string | null> {
  if (targetType === 'thread') {
    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', targetId))
      .first();
    if (!meta || meta.organizationId !== organizationId) return null;
    return meta.userId ?? null;
  }
  if (targetType === 'document') {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- targetId is a stringified _id; ctx.db.get returns null on mismatch
      const doc = await ctx.db.get(targetId as Doc<'documents'>['_id']);
      if (!doc || doc.organizationId !== organizationId) return null;
      return doc.createdBy ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

export const getLegalHoldByTarget = query({
  args: {
    organizationId: v.string(),
    targetType: targetTypeValidator,
    targetId: v.string(),
  },
  returns: heldByTargetValidator,
  handler: async (ctx, args) => {
    const caller = await requireMember(ctx, args.organizationId);

    // Pass A — direct match on (organizationId, targetType, targetId).
    const directHold = await ctx.db
      .query('legalHolds')
      .withIndex('by_target', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('targetType', args.targetType)
          .eq('targetId', args.targetId),
      )
      .filter((q) => q.eq(q.field('releasedAt'), undefined))
      .first();

    // Pass B — cascade. For thread/document, look up the author user
    // and check whether they're on a userMembership hold. Skip for
    // userMembership/org/execution (no cascade-author concept).
    let cascadeHold: Doc<'legalHolds'> | null = null;
    if (
      !directHold &&
      (args.targetType === 'thread' || args.targetType === 'document')
    ) {
      const authorUserId = await resolveEntityAuthor(
        ctx,
        args.organizationId,
        args.targetType,
        args.targetId,
      );
      if (authorUserId) {
        const candidate = await ctx.db
          .query('legalHolds')
          .withIndex('by_target', (q) =>
            q
              .eq('organizationId', args.organizationId)
              .eq('targetType', 'userMembership')
              .eq('targetId', authorUserId),
          )
          .filter((q) => q.eq(q.field('releasedAt'), undefined))
          .first();
        if (candidate) cascadeHold = candidate;
      }
    }

    const hold = directHold ?? cascadeHold;
    if (!hold) return null;
    const via: 'direct' | 'user_custodian' =
      directHold !== null ? 'direct' : 'user_custodian';

    // Latest release request for this hold (any status).
    const latest = await ctx.db
      .query('legalHoldReleaseRequests')
      .withIndex('by_holdId', (q) => q.eq('holdId', hold._id))
      .order('desc')
      .first();
    const hasPendingRelease = latest?.status === 'pending';
    const hasApprovedRelease = latest?.status === 'approved';
    const effectiveAt = hasApprovedRelease ? latest?.effectiveAt : undefined;

    if (!caller.isAdmin) {
      return {
        _id: hold._id,
        targetType: hold.targetType,
        targetId: hold.targetId,
        placedAt: hold.placedAt,
        view: 'member' as const,
        via,
        hasPendingRelease,
        hasApprovedRelease,
        effectiveAt,
      };
    }

    // Admin view — include reason / matter / placedBy.
    const matterName = hold.matterRef
      ? (
          await resolveMatterNames(ctx, args.organizationId, [hold.matterRef])
        ).get(hold.matterRef)
      : undefined;
    const nameMap = await getUserNamesBatch(ctx, [hold.placedBy]);

    return {
      _id: hold._id,
      targetType: hold.targetType,
      targetId: hold.targetId,
      placedAt: hold.placedAt,
      view: 'admin' as const,
      via,
      reason: hold.reason,
      matterRef: hold.matterRef,
      matterName,
      placedBy: hold.placedBy,
      placedByName: nameMap.get(hold.placedBy) ?? hold.placedBy,
      hasPendingRelease,
      hasApprovedRelease,
      effectiveAt,
    };
  },
});

/**
 * Batch lookup so chat-history sidebar / document grid can render lock
 * badges without N+1 round-trips. Member-readable: knowing _that_ a
 * thread / document is held is fine for any org member; the reason and
 * matter linkage stay admin-only via `getLegalHoldByTarget`.
 */
export const listActiveHoldTargetIds = query({
  args: {
    organizationId: v.string(),
    targetType: targetTypeValidator,
  },
  returns: v.object({
    targetIds: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);

    // Direct holds against the requested target type.
    const directRows = await ctx.db
      .query('legalHolds')
      .withIndex('by_organizationId_targetType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('targetType', args.targetType),
      )
      .collect();
    const ids = new Set<string>(
      directRows
        .filter((r) => r.releasedAt === undefined)
        .map((r) => r.targetId),
    );

    // Cascade: for thread / document badges, also include entities whose
    // author is on a userMembership hold. execution has no author field;
    // userMembership / org don't cascade.
    if (args.targetType === 'thread' || args.targetType === 'document') {
      const heldUserRows = await ctx.db
        .query('legalHolds')
        .withIndex('by_organizationId_targetType', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('targetType', 'userMembership'),
        )
        .collect();
      const heldUserIds = heldUserRows
        .filter((r) => r.releasedAt === undefined)
        .map((r) => r.targetId);

      if (heldUserIds.length > 0) {
        if (args.targetType === 'thread') {
          for (const userId of heldUserIds) {
            const threads = await ctx.db
              .query('threadMetadata')
              .withIndex('by_userId_chatType_status', (q) =>
                q.eq('userId', userId),
              )
              .filter((q) =>
                q.eq(q.field('organizationId'), args.organizationId),
              )
              .collect();
            for (const t of threads) ids.add(t.threadId);
          }
        } else {
          for (const userId of heldUserIds) {
            const docs = await ctx.db
              .query('documents')
              .withIndex('by_organizationId_and_createdBy', (q) =>
                q
                  .eq('organizationId', args.organizationId)
                  .eq('createdBy', userId),
              )
              .collect();
            for (const d of docs) ids.add(String(d._id));
          }
        }
      }
    }

    return { targetIds: Array.from(ids) };
  },
});

/**
 * Picker source for the "Place hold on user" dialog. Admin-gated. Returns
 * up to 100 active members of the org with their email + display name so
 * the UI can render a searchable combobox.
 *
 * The Better Auth `member` row points at a `userId`, but the email and
 * name live on the `user` table — fetch in two passes (member list, then
 * batched user lookup) and join in memory. Capped at 100 to keep the
 * query bounded; orgs that exceed that should add server-side search
 * later.
 */
export const listOrgMembersForPicker = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(
    v.object({
      userId: v.string(),
      email: v.string(),
      displayName: v.string(),
      role: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.organizationId);

    const memberPage = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 100 },
        where: [
          {
            field: 'organizationId',
            value: args.organizationId,
            operator: 'eq',
          },
        ],
      },
    );

    const rawRows = memberPage?.page ?? [];
    const members: Array<{ userId: string; role: string; createdAt: number }> =
      [];
    for (const raw of rawRows) {
      if (!isRecord(raw)) continue;
      const userId = getString(raw, 'userId');
      if (!userId) continue;
      const role = getString(raw, 'role') ?? 'member';
      if (role.toLowerCase() === 'disabled') continue;
      members.push({
        userId,
        role,
        createdAt: getNumber(raw, 'createdAt') ?? 0,
      });
    }

    // Batch lookup of user.email/name. Reuse the existing helper which
    // returns name-or-email; we then ALSO need raw email for searching,
    // so issue per-user findMany lookups in parallel.
    const userPromises = members.map(async (m) => {
      try {
        const userRes = await ctx.runQuery(
          components.betterAuth.adapter.findMany,
          {
            model: 'user',
            paginationOpts: { cursor: null, numItems: 1 },
            where: [{ field: '_id', value: m.userId, operator: 'eq' }],
          },
        );
        const userRaw = userRes?.page?.[0];
        if (!isRecord(userRaw)) return null;
        const email = getString(userRaw, 'email') ?? '';
        const name = getString(userRaw, 'name') ?? '';
        return {
          userId: m.userId,
          email,
          displayName: name || email || m.userId,
          role: m.role,
        };
      } catch (err) {
        console.warn(
          `[listOrgMembersForPicker] user lookup failed for userId='${m.userId}': ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    });

    const resolved = (await Promise.all(userPromises)).filter(
      (u): u is NonNullable<typeof u> => u !== null,
    );

    // Sort by displayName for stable picker UX.
    resolved.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return resolved;
  },
});
