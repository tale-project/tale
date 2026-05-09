import { v } from 'convex/values';

import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import { authComponent } from '../auth';
import { getUserNamesBatch } from '../documents/get_user_names_batch';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { checkBudget } from './budget_enforcement';
import { resolveFeatureFlags } from './feature_enforcement';
import { getOrgUsageMetrics as getOrgUsageMetricsHandler } from './get_org_usage_metrics';
import { getAccessibleModels } from './model_access_enforcement';
import { GOVERNANCE_POLICY_TYPES } from './schema';
import {
  SOFT_DELETE_RESOURCE_CONFIG,
  type ResourceConfig,
} from './soft_delete_helpers';
import {
  type SoftDeleteResourceType,
  softDeleteResourceTypeValidator,
} from './soft_delete_validators';

/**
 * Phase 13 — pending retention shortening for the editor banner.
 * Admin-only. Returns the most recent pending row for the org, or
 * `null` when none exists / cooldown is over.
 */
export const getPendingRetentionChange = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email ?? '',
    });
    if (!isAdmin(member.role)) {
      throw new Error('Admin role required.');
    }
    const row = await ctx.db
      .query('retentionPolicyPendingChanges')
      .withIndex('by_organizationId_appliesAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')
      .first();
    if (!row) return null;
    if (row.appliesAt <= Date.now()) return null;
    return {
      _id: row._id,
      appliesAt: row.appliesAt,
      summary: row.summary,
      requestedBy: row.requestedBy,
      requestedAt: row.requestedAt,
    };
  },
});

const policyTypeValidator = v.union(
  ...GOVERNANCE_POLICY_TYPES.map((t) => v.literal(t)),
);

/**
 * Policy types that any org member can read. The remaining types
 * (login_policy.trustedProxies, password_policy, two_factor_policy,
 * model_access.rules, budgets, retention_policy,
 * moderation_provider.endpoint, system_prompt — anything that exposes
 * security or operator-secret config) require admin role. The
 * member-readable set deliberately stays minimal: features the user
 * actually toggles in the UI, plus the data-classification notice
 * which the chat composer renders for every member.
 */
const POLICY_TYPES_READABLE_BY_MEMBER: ReadonlySet<string> = new Set([
  'data_classification_notice',
  'feature_flags',
  'pii_config',
  'chat_filter',
  'personalization',
  'upload_policy',
  'default_models',
]);

export const getPolicy = query({
  args: {
    organizationId: v.string(),
    policyType: policyTypeValidator,
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    // Sensitive policies (admin-only). Every other type stays open to
    // any org member.
    if (
      !POLICY_TYPES_READABLE_BY_MEMBER.has(args.policyType) &&
      !isAdmin(member.role)
    ) {
      throw new Error(`Reading ${args.policyType} requires admin role.`);
    }

    const policy = await ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('policyType', args.policyType),
      )
      .first();

    // Cooldown overlay: when a retention shortening is in flight, the
    // live row carries the new (shortened) config but the cleanup
    // runner uses `pending.oldConfig` until the cooldown elapses. Any
    // other read of the row (the editor itself, future features) must
    // see the same effective config the cleanup runner does — otherwise
    // the UI shows the new values immediately while data is still being
    // retained at the old window. Overlay only for retention_policy.
    if (policy && args.policyType === 'retention_policy') {
      const pending = await ctx.db
        .query('retentionPolicyPendingChanges')
        .withIndex('by_organizationId_appliesAt', (q) =>
          q.eq('organizationId', args.organizationId),
        )
        .order('desc')
        .first();
      if (pending && pending.appliesAt > Date.now()) {
        return { ...policy, config: pending.oldConfig };
      }
    }
    return policy;
  },
});

export const listPolicies = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    // Non-admins only see member-readable policy types. Admins see all.
    const restrictToMemberReadable = !isAdmin(member.role);

    const policies: Array<{
      _id: string;
      policyType: string;
      config: unknown;
      updatedAt?: number;
      updatedBy?: string;
    }> = [];

    for await (const policy of ctx.db
      .query('governancePolicies')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (
        restrictToMemberReadable &&
        !POLICY_TYPES_READABLE_BY_MEMBER.has(policy.policyType)
      ) {
        continue;
      }
      policies.push({
        _id: String(policy._id),
        policyType: policy.policyType,
        config: policy.config,
        updatedAt: policy.updatedAt,
        updatedBy: policy.updatedBy,
      });
    }

    return policies;
  },
});

export const getUsageSummary = query({
  args: {
    organizationId: v.string(),
    periodKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });
    if (!isAdmin(member.role)) {
      throw new Error('Only admins can view usage summaries');
    }

    const now = new Date();
    const defaultPeriodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const periodKey = args.periodKey ?? defaultPeriodKey;

    const rawEntries: Array<{
      userId: string;
      teamId?: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costEstimate: number;
      requestCount: number;
    }> = [];

    for await (const entry of ctx.db
      .query('usageLedger')
      .withIndex('by_org_period', (q) =>
        q.eq('organizationId', args.organizationId).eq('periodKey', periodKey),
      )) {
      rawEntries.push({
        userId: entry.userId,
        teamId: entry.teamId,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        totalTokens: entry.totalTokens,
        costEstimate: entry.costEstimate,
        requestCount: entry.requestCount,
      });
    }

    const userIds = rawEntries.map((e) => e.userId);
    const userNameMap = await getUserNamesBatch(ctx, userIds);

    const entries = rawEntries.map((e) =>
      Object.assign({}, e, {
        displayName: userNameMap.get(e.userId) ?? e.userId,
      }),
    );

    return {
      periodKey,
      entries,
      totals: entries.reduce(
        (acc, e) => ({
          inputTokens: acc.inputTokens + e.inputTokens,
          outputTokens: acc.outputTokens + e.outputTokens,
          totalTokens: acc.totalTokens + e.totalTokens,
          costEstimate: acc.costEstimate + e.costEstimate,
          requestCount: acc.requestCount + e.requestCount,
        }),
        {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costEstimate: 0,
          requestCount: 0,
        },
      ),
    };
  },
});

export const getOrgUsageMetrics = query({
  args: {
    organizationId: v.string(),
    periodDays: v.union(v.literal(7), v.literal(30), v.literal(90)),
    granularity: v.union(
      v.literal('daily'),
      v.literal('weekly'),
      v.literal('monthly'),
    ),
    agentSlug: v.optional(v.string()),
    model: v.optional(v.string()),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });
    if (!isAdmin(member.role)) {
      throw new Error('Only admins can view usage metrics');
    }

    return getOrgUsageMetricsHandler(ctx, args);
  },
});

export const getMyFeatureFlags = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const userId = String(authUser._id);
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId,
      email: authUser.email,
      name: authUser.name,
    });

    const teamIds = await getUserTeamIds(ctx, userId);
    return resolveFeatureFlags(
      ctx,
      args.organizationId,
      userId,
      teamIds,
      member.role,
    );
  },
});

export const getMyBudgetStatus = query({
  args: {
    organizationId: v.string(),
    selectedTeamId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const userId = String(authUser._id);
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId,
      email: authUser.email,
      name: authUser.name,
    });

    const allTeamIds = await getUserTeamIds(ctx, userId);

    // For exceeded checks, always use all teams so hard blocks are never hidden
    const fullResult = await checkBudget(
      ctx,
      args.organizationId,
      userId,
      allTeamIds,
      member.role,
    );

    // Budget exceeded — always show regardless of team selection
    if (!fullResult.allowed) {
      return {
        exceeded: true as const,
        code: fullResult.code ?? null,
        period: fullResult.period ?? null,
        used: fullResult.used ?? null,
        limit: fullResult.limit ?? null,
        reason: fullResult.reason ?? null,
        warnings: null,
      };
    }

    // For warnings, filter by selected team context
    const displayTeamIds =
      args.selectedTeamId && allTeamIds.includes(args.selectedTeamId)
        ? [args.selectedTeamId]
        : [];
    const displayResult = await checkBudget(
      ctx,
      args.organizationId,
      userId,
      displayTeamIds,
      member.role,
    );

    // Approaching limit — return warnings scoped to team selection
    if (displayResult.warnings && displayResult.warnings.length > 0) {
      return {
        exceeded: false as const,
        code: null,
        period: null,
        used: null,
        limit: null,
        reason: null,
        warnings: displayResult.warnings,
      };
    }

    return null;
  },
});

export const getAccessibleModelsForUser = query({
  args: {
    organizationId: v.string(),
    modelIds: v.array(v.string()),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const teamIds = await getUserTeamIds(ctx, String(authUser._id));

    return getAccessibleModels(
      ctx,
      args.organizationId,
      String(authUser._id),
      teamIds,
      member.role,
      args.modelIds,
    );
  },
});

/**
 * Admin-only listing of retention-trashed rows for the Trash UI under
 * `settings/governance/trash`. Unified across resource types: by
 * default returns trashed/expired rows from every restorable category
 * merged into one cursor-paginated stream sorted by
 * `(effectiveTs desc, id desc)` where `effectiveTs = statusChangedAt ??
 * createdAt`. Caller can narrow with `resourceTypes` (multi-select).
 *
 * Per-resource dispatch internally because each table's
 * `lifecycleStatus` index is table-specific (Convex `withIndex` typing
 * prevents a single generic query body). Threads use the legacy
 * `status` field; everyone else uses `lifecycleStatus`.
 *
 * Pagination via time-window cursor `(ts, id)`. Each per-table
 * subquery takes `(limit + PER_TABLE_BUFFER)` rows scoped to
 * `effectiveTs < cursor.ts || (effectiveTs === cursor.ts && id <
 * cursor.id)`; the merge → sort → slice produces the page and the
 * next cursor. Robust as long as no single table has more than
 * `PER_TABLE_BUFFER` rows tied at the cursor's `ts` — true at typical
 * org volumes (trash is bounded by retention × grace).
 */
const TRASH_DEFAULT_LIMIT = 50;
const TRASH_MAX_LIMIT = 200;
const PER_TABLE_BUFFER = 200;

const TRASH_VISIBLE_RESOURCE_TYPES: ReadonlyArray<SoftDeleteResourceType> = [
  'thread',
  'document',
  'fileMetadata',
  'promptTemplate',
  'messageFeedback',
  'customer',
  'vendor',
  'externalConversation',
  'workflowExecution',
  'usageLedger',
  'auditLog',
  'chatFilterEvent',
  'memoryAudit',
];

interface TrashRow {
  resourceType: SoftDeleteResourceType;
  id: string;
  status: 'trashed' | 'expired';
  statusChangedAt: number | null;
  createdAt: number;
  displayName: string | null;
  ownerId: string | null;
  ownerName: string | null;
}

interface TrashCursor {
  ts: number;
  id: string;
}

const trashCursorValidator = v.object({
  ts: v.number(),
  id: v.string(),
});

const trashRowValidator = v.object({
  resourceType: softDeleteResourceTypeValidator,
  id: v.string(),
  status: v.union(v.literal('trashed'), v.literal('expired')),
  statusChangedAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  displayName: v.union(v.string(), v.null()),
  ownerId: v.union(v.string(), v.null()),
  ownerName: v.union(v.string(), v.null()),
});

export const listTrashedRows = query({
  args: {
    organizationId: v.string(),
    resourceTypes: v.optional(v.array(softDeleteResourceTypeValidator)),
    cursor: v.optional(v.union(trashCursorValidator, v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    rows: v.array(trashRowValidator),
    nextCursor: v.union(trashCursorValidator, v.null()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ rows: TrashRow[]; nextCursor: TrashCursor | null }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });
    if (!isAdmin(member.role)) {
      throw new Error('Trash listing requires admin role.');
    }

    const limit = Math.min(
      Math.max(1, args.limit ?? TRASH_DEFAULT_LIMIT),
      TRASH_MAX_LIMIT,
    );
    const cursor = args.cursor ?? null;
    const requested = args.resourceTypes;
    const types =
      requested && requested.length > 0
        ? // Drop cascade children if a caller passes them explicitly —
          // they don't have own trash entries.
          requested.filter((rt) => TRASH_VISIBLE_RESOURCE_TYPES.includes(rt))
        : TRASH_VISIBLE_RESOURCE_TYPES;

    const merged: TrashRow[] = [];
    for (const rt of types) {
      const sub = await fetchTrashSubpage(
        ctx,
        args.organizationId,
        rt,
        cursor,
        limit + PER_TABLE_BUFFER,
      );
      merged.push(...sub);
    }

    merged.sort(compareTrashRowDesc);

    const page = merged.slice(0, limit);
    const hasMore = merged.length > limit;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? { ts: last.statusChangedAt ?? last.createdAt, id: last.id }
        : null;

    // Resolve owner display names against Better Auth in one batched
    // pass. Only on the visible page so the lookup count stays bounded
    // by `TRASH_MAX_LIMIT` regardless of per-subpage buffer size.
    const ownerIds: string[] = [];
    for (const row of page) {
      if (row.ownerId) ownerIds.push(row.ownerId);
    }
    if (ownerIds.length > 0) {
      const names = await getUserNamesBatch(ctx, ownerIds);
      for (const row of page) {
        if (row.ownerId) {
          row.ownerName = names.get(row.ownerId) ?? null;
        }
      }
    }

    return { rows: page, nextCursor };
  },
});

function compareTrashRowDesc(a: TrashRow, b: TrashRow): number {
  const aTs = a.statusChangedAt ?? a.createdAt;
  const bTs = b.statusChangedAt ?? b.createdAt;
  if (aTs !== bTs) return bTs - aTs;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/**
 * `cursor` semantics: caller has already seen rows with effectiveTs >
 * cursor.ts, plus rows at exactly cursor.ts whose id >= cursor.id.
 * Sub-page returns only rows strictly past the cursor in
 * `(effectiveTs desc, id desc)` order.
 */
function passesCursor(
  effectiveTs: number,
  id: string,
  cursor: TrashCursor | null,
): boolean {
  if (cursor === null) return true;
  if (effectiveTs < cursor.ts) return true;
  if (effectiveTs > cursor.ts) return false;
  return id < cursor.id;
}

async function fetchTrashSubpage(
  ctx: QueryCtx,
  organizationId: string,
  rt: SoftDeleteResourceType,
  cursor: TrashCursor | null,
  take: number,
): Promise<TrashRow[]> {
  const config = SOFT_DELETE_RESOURCE_CONFIG[rt];
  switch (rt) {
    case 'thread': {
      // Round-2 V9 P1-M: narrow on `status` so the `take` budget isn't
      // saturated by active rows (the index range walks the active
      // prefix first and would never reach trashed/expired tail in any
      // org with a non-trivial number of active threads). Two equality
      // slices, merged by recency.
      const trashed = await ctx.db
        .query('threadMetadata')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', organizationId).eq('status', 'trashed'),
        )
        .take(take);
      const expired = await ctx.db
        .query('threadMetadata')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', organizationId).eq('status', 'expired'),
        )
        .take(take);
      const all = [...trashed, ...expired];
      return projectSubpage(rt, config, all, (r) => ({
        status: r.status,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r.createdAt ?? r._creationTime,
      })).filter((row) =>
        passesCursor(row.statusChangedAt ?? row.createdAt, row.id, cursor),
      );
    }
    // Round-2 review CRITICAL #15: the `(organizationId, lifecycleStatus)`
    // compound index orders rows alphabetically by status (`'active' <
    // 'deleted' < 'expired' < 'trashed'`), so a `.take(N)` query that
    // only `.eq`'s on `organizationId` consumes its budget on active
    // rows first — the Trash UI renders empty for any org with ≥250
    // active rows of that type. Fix: issue two `.eq('lifecycleStatus',
    // ...)` queries and merge. Mirrors the thread case above.
    case 'document': {
      const trashed = await ctx.db
        .query('documents')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'trashed'),
        )
        .take(take);
      const expired = await ctx.db
        .query('documents')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'expired'),
        )
        .take(take);
      return projectSubpage(rt, config, [...trashed, ...expired], (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r._creationTime,
      })).filter((row) =>
        passesCursor(row.statusChangedAt ?? row.createdAt, row.id, cursor),
      );
    }
    case 'fileMetadata': {
      const trashed = await ctx.db
        .query('fileMetadata')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'trashed'),
        )
        .take(take);
      const expired = await ctx.db
        .query('fileMetadata')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'expired'),
        )
        .take(take);
      return projectSubpage(rt, config, [...trashed, ...expired], (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r._creationTime,
      })).filter((row) =>
        passesCursor(row.statusChangedAt ?? row.createdAt, row.id, cursor),
      );
    }
    case 'promptTemplate': {
      const trashed = await ctx.db
        .query('promptTemplates')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'trashed'),
        )
        .take(take);
      const expired = await ctx.db
        .query('promptTemplates')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'expired'),
        )
        .take(take);
      return projectSubpage(rt, config, [...trashed, ...expired], (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r._creationTime,
      })).filter((row) =>
        passesCursor(row.statusChangedAt ?? row.createdAt, row.id, cursor),
      );
    }
    case 'messageFeedback': {
      const trashed = await ctx.db
        .query('messageFeedback')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'trashed'),
        )
        .take(take);
      const expired = await ctx.db
        .query('messageFeedback')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'expired'),
        )
        .take(take);
      return projectSubpage(rt, config, [...trashed, ...expired], (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r.createdAt ?? r._creationTime,
      })).filter((row) =>
        passesCursor(row.statusChangedAt ?? row.createdAt, row.id, cursor),
      );
    }
    case 'customer': {
      const trashed = await ctx.db
        .query('customers')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'trashed'),
        )
        .take(take);
      const expired = await ctx.db
        .query('customers')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'expired'),
        )
        .take(take);
      return projectSubpage(rt, config, [...trashed, ...expired], (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r._creationTime,
      })).filter((row) =>
        passesCursor(row.statusChangedAt ?? row.createdAt, row.id, cursor),
      );
    }
    case 'vendor': {
      const trashed = await ctx.db
        .query('vendors')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'trashed'),
        )
        .take(take);
      const expired = await ctx.db
        .query('vendors')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'expired'),
        )
        .take(take);
      return projectSubpage(rt, config, [...trashed, ...expired], (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r._creationTime,
      })).filter((row) =>
        passesCursor(row.statusChangedAt ?? row.createdAt, row.id, cursor),
      );
    }
    case 'externalConversation': {
      const trashed = await ctx.db
        .query('conversations')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'trashed'),
        )
        .take(take);
      const expired = await ctx.db
        .query('conversations')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'expired'),
        )
        .take(take);
      return projectSubpage(rt, config, [...trashed, ...expired], (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r._creationTime,
      })).filter((row) =>
        passesCursor(row.statusChangedAt ?? row.createdAt, row.id, cursor),
      );
    }
    case 'workflowExecution': {
      const trashed = await ctx.db
        .query('wfExecutions')
        .withIndex('by_org_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'trashed'),
        )
        .take(take);
      const expired = await ctx.db
        .query('wfExecutions')
        .withIndex('by_org_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'expired'),
        )
        .take(take);
      return projectSubpage(rt, config, [...trashed, ...expired], (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r.startedAt ?? r._creationTime,
      })).filter((row) =>
        passesCursor(row.statusChangedAt ?? row.createdAt, row.id, cursor),
      );
    }
    case 'usageLedger': {
      const trashed = await ctx.db
        .query('usageLedger')
        .withIndex('by_org_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'trashed'),
        )
        .take(take);
      const expired = await ctx.db
        .query('usageLedger')
        .withIndex('by_org_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'expired'),
        )
        .take(take);
      return projectSubpage(rt, config, [...trashed, ...expired], (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r._creationTime,
      })).filter((row) =>
        passesCursor(row.statusChangedAt ?? row.createdAt, row.id, cursor),
      );
    }
    case 'auditLog': {
      const trashed = await ctx.db
        .query('auditLogs')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'trashed'),
        )
        .take(take);
      const expired = await ctx.db
        .query('auditLogs')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'expired'),
        )
        .take(take);
      return projectSubpage(rt, config, [...trashed, ...expired], (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r.timestamp ?? r._creationTime,
      })).filter((row) =>
        passesCursor(row.statusChangedAt ?? row.createdAt, row.id, cursor),
      );
    }
    case 'chatFilterEvent': {
      const trashed = await ctx.db
        .query('chatFilterEvents')
        .withIndex('by_org_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'trashed'),
        )
        .take(take);
      const expired = await ctx.db
        .query('chatFilterEvents')
        .withIndex('by_org_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'expired'),
        )
        .take(take);
      return projectSubpage(rt, config, [...trashed, ...expired], (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r.createdAt ?? r._creationTime,
      })).filter((row) =>
        passesCursor(row.statusChangedAt ?? row.createdAt, row.id, cursor),
      );
    }
    case 'memoryAudit': {
      const trashed = await ctx.db
        .query('userMemoryAuditLog')
        .withIndex('by_org_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'trashed'),
        )
        .take(take);
      const expired = await ctx.db
        .query('userMemoryAuditLog')
        .withIndex('by_org_lifecycleStatus', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('lifecycleStatus', 'expired'),
        )
        .take(take);
      return projectSubpage(rt, config, [...trashed, ...expired], (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r.createdAt ?? r._creationTime,
      })).filter((row) =>
        passesCursor(row.statusChangedAt ?? row.createdAt, row.id, cursor),
      );
    }
  }
  return [];
}

interface RowMeta {
  status: string | undefined;
  statusChangedAt: number | null;
  createdAt: number;
}

function projectSubpage<T extends { _id: unknown; _creationTime: number }>(
  resourceType: SoftDeleteResourceType,
  config: ResourceConfig,
  rows: T[],
  meta: (r: T) => RowMeta,
): TrashRow[] {
  const out: TrashRow[] = [];
  for (const row of rows) {
    const m = meta(row);
    if (m.status !== 'trashed' && m.status !== 'expired') continue;
    out.push({
      resourceType,
      id: String(row._id),
      status: m.status,
      statusChangedAt: m.statusChangedAt,
      createdAt: m.createdAt,
      displayName: pickStringField(row, config.displayNameField),
      ownerId: pickStringField(row, config.authorField),
      ownerName: null,
    });
  }
  return out;
}

function pickStringField(
  row: unknown,
  field: string | undefined,
): string | null {
  if (!field || row === null || typeof row !== 'object') {
    return null;
  }
  if (!Object.hasOwn(row, field)) return null;
  const value = Reflect.get(row, field);
  return typeof value === 'string' && value.length > 0 ? value : null;
}
