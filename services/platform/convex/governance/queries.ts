import { v } from 'convex/values';

import { query } from '../_generated/server';
import { authComponent } from '../auth';
import { getUserNamesBatch } from '../documents/get_user_names_batch';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { checkBudget } from './budget_enforcement';
import { resolveFeatureFlags } from './feature_enforcement';
import { getOrgUsageMetrics as getOrgUsageMetricsHandler } from './get_org_usage_metrics';
import { getAccessibleModels } from './model_access_enforcement';
import { getAllRetentionBounds, isRetentionDisabled } from './retention_floors';
import { GOVERNANCE_POLICY_TYPES } from './schema';

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

/**
 * Effective retention bounds (min + max) for every category, including
 * the operator's env-var overrides. The retention editor uses this to
 * render `<input min={N} max={M}>` plus helper text BEFORE the user
 * types something out-of-range, so they never get the "you tried 365
 * days but operator caps at 100" toast — the input just refuses.
 *
 * Open to any org member; the bounds are operator-set, not org-secret.
 */
export const getEffectiveRetentionBounds = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }
    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email ?? '',
    });
    return {
      bounds: getAllRetentionBounds(),
      retentionDisabled: isRetentionDisabled(),
    };
  },
});

const policyTypeValidator = v.union(
  ...GOVERNANCE_POLICY_TYPES.map((t) => v.literal(t)),
);

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

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    return ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('policyType', args.policyType),
      )
      .first();
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

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

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
