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
 * `settings/governance/trash`. Per-resource dispatch because each
 * table's `lifecycleStatus` index is table-specific (Convex
 * `withIndex` typing prevents a single generic query body).
 *
 * Threads use the legacy `status` field; everyone else uses
 * `lifecycleStatus`. Returned rows project to a uniform shape so the
 * UI can render any resource type with the same column config.
 *
 * Pagination is take-N (no continueCursor); typical trash volume is
 * small enough that a single page covers the active grace window. If
 * volume grows we can switch to `paginate()` later.
 */
const TRASH_PAGE_SIZE = 200;

interface TrashRow {
  id: string;
  status: 'trashed' | 'expired';
  statusChangedAt: number | null;
  createdAt: number;
  displayName: string | null;
}

export const listTrashedRows = query({
  args: {
    organizationId: v.string(),
    resourceType: softDeleteResourceTypeValidator,
  },
  returns: v.object({
    rows: v.array(
      v.object({
        id: v.string(),
        status: v.union(v.literal('trashed'), v.literal('expired')),
        statusChangedAt: v.union(v.number(), v.null()),
        createdAt: v.number(),
        displayName: v.union(v.string(), v.null()),
      }),
    ),
    truncated: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ rows: TrashRow[]; truncated: boolean }> => {
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

    return await listTrashForResource(
      ctx,
      args.organizationId,
      args.resourceType,
    );
  },
});

async function listTrashForResource(
  ctx: QueryCtx,
  organizationId: string,
  rt: SoftDeleteResourceType,
): Promise<{ rows: TrashRow[]; truncated: boolean }> {
  const config = SOFT_DELETE_RESOURCE_CONFIG[rt];
  switch (rt) {
    case 'thread': {
      // threadMetadata uses `status`. No by_org_status index — query by
      // org and filter in memory. Trash is bounded by retention*grace
      // so volume is small.
      const all = await ctx.db
        .query('threadMetadata')
        .withIndex('by_organizationId', (q) =>
          q.eq('organizationId', organizationId),
        )
        .take(TRASH_PAGE_SIZE * 4);
      const filtered = all.filter(
        (r) => r.status === 'trashed' || r.status === 'expired',
      );
      return projectRows(filtered, config, (r) => ({
        status: r.status,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r.createdAt ?? r._creationTime,
      }));
    }
    case 'document': {
      const all = await ctx.db
        .query('documents')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q.eq('organizationId', organizationId),
        )
        .take(TRASH_PAGE_SIZE * 4);
      return projectRows(all, config, (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r._creationTime,
      }));
    }
    case 'fileMetadata': {
      const all = await ctx.db
        .query('fileMetadata')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q.eq('organizationId', organizationId),
        )
        .take(TRASH_PAGE_SIZE * 4);
      return projectRows(all, config, (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r._creationTime,
      }));
    }
    case 'promptTemplate': {
      const all = await ctx.db
        .query('promptTemplates')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q.eq('organizationId', organizationId),
        )
        .take(TRASH_PAGE_SIZE * 4);
      return projectRows(all, config, (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r._creationTime,
      }));
    }
    case 'messageFeedback': {
      const all = await ctx.db
        .query('messageFeedback')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q.eq('organizationId', organizationId),
        )
        .take(TRASH_PAGE_SIZE * 4);
      return projectRows(all, config, (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r.createdAt ?? r._creationTime,
      }));
    }
    case 'customer': {
      const all = await ctx.db
        .query('customers')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q.eq('organizationId', organizationId),
        )
        .take(TRASH_PAGE_SIZE * 4);
      return projectRows(all, config, (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r._creationTime,
      }));
    }
    case 'vendor': {
      const all = await ctx.db
        .query('vendors')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q.eq('organizationId', organizationId),
        )
        .take(TRASH_PAGE_SIZE * 4);
      return projectRows(all, config, (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r._creationTime,
      }));
    }
    case 'externalConversation': {
      const all = await ctx.db
        .query('conversations')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q.eq('organizationId', organizationId),
        )
        .take(TRASH_PAGE_SIZE * 4);
      return projectRows(all, config, (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r._creationTime,
      }));
    }
    case 'workflowExecution': {
      const all = await ctx.db
        .query('wfExecutions')
        .withIndex('by_org_lifecycleStatus', (q) =>
          q.eq('organizationId', organizationId),
        )
        .take(TRASH_PAGE_SIZE * 4);
      return projectRows(all, config, (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r.startedAt ?? r._creationTime,
      }));
    }
    case 'usageLedger': {
      const all = await ctx.db
        .query('usageLedger')
        .withIndex('by_org_lifecycleStatus', (q) =>
          q.eq('organizationId', organizationId),
        )
        .take(TRASH_PAGE_SIZE * 4);
      return projectRows(all, config, (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r._creationTime,
      }));
    }
    case 'auditLog': {
      const all = await ctx.db
        .query('auditLogs')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q.eq('organizationId', organizationId),
        )
        .take(TRASH_PAGE_SIZE * 4);
      return projectRows(all, config, (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r.timestamp ?? r._creationTime,
      }));
    }
    case 'chatFilterEvent': {
      const all = await ctx.db
        .query('chatFilterEvents')
        .withIndex('by_org_lifecycleStatus', (q) =>
          q.eq('organizationId', organizationId),
        )
        .take(TRASH_PAGE_SIZE * 4);
      return projectRows(all, config, (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r.createdAt ?? r._creationTime,
      }));
    }
    case 'memoryAudit': {
      const all = await ctx.db
        .query('userMemoryAuditLog')
        .withIndex('by_org_lifecycleStatus', (q) =>
          q.eq('organizationId', organizationId),
        )
        .take(TRASH_PAGE_SIZE * 4);
      return projectRows(all, config, (r) => ({
        status: r.lifecycleStatus,
        statusChangedAt: r.statusChangedAt ?? null,
        createdAt: r.createdAt ?? r._creationTime,
      }));
    }
    case 'messageMetadata':
    case 'workflowTriggerLog':
      // These are cascade children of other resources; no own trash tab.
      return { rows: [], truncated: false };
  }
  // oxlint can't prove the switch is exhaustive over the resource-type
  // union; this trailing fallback keeps consistent-return happy and
  // documents intent.
  return { rows: [], truncated: false };
}

interface RowMeta {
  status: string | undefined;
  statusChangedAt: number | null;
  createdAt: number;
}

function projectRows<T extends { _id: unknown; _creationTime: number }>(
  rows: T[],
  config: ResourceConfig,
  meta: (r: T) => RowMeta,
): { rows: TrashRow[]; truncated: boolean } {
  const out: TrashRow[] = [];
  for (const row of rows) {
    const m = meta(row);
    if (m.status !== 'trashed' && m.status !== 'expired') continue;
    out.push({
      id: String(row._id),
      status: m.status,
      statusChangedAt: m.statusChangedAt,
      createdAt: m.createdAt,
      displayName: pickDisplayName(row, config),
    });
  }
  out.sort(
    (a, b) =>
      (b.statusChangedAt ?? b.createdAt) - (a.statusChangedAt ?? a.createdAt),
  );
  return {
    rows: out.slice(0, TRASH_PAGE_SIZE),
    truncated: out.length > TRASH_PAGE_SIZE,
  };
}

function pickDisplayName(row: unknown, config: ResourceConfig): string | null {
  if (!config.displayNameField || row === null || typeof row !== 'object') {
    return null;
  }
  if (!Object.hasOwn(row, config.displayNameField)) return null;
  const value = Reflect.get(row, config.displayNameField);
  return typeof value === 'string' ? value : null;
}
