import { v } from 'convex/values';

import { query } from '../_generated/server';
import { authComponent } from '../auth';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { checkBudget } from './budget_enforcement';
import { resolveFeatureFlags } from './feature_enforcement';
import { getAccessibleModels } from './model_access_enforcement';
import { GOVERNANCE_POLICY_TYPES } from './schema';

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

    const entries: Array<{
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
      entries.push({
        userId: entry.userId,
        teamId: entry.teamId,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        totalTokens: entry.totalTokens,
        costEstimate: entry.costEstimate,
        requestCount: entry.requestCount,
      });
    }

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
