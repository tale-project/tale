import type { GenericQueryCtx } from 'convex/server';

import type {
  BudgetConfig,
  BudgetRule,
} from '../../lib/shared/schemas/governance';
import type { DataModel } from '../_generated/dataModel';
import { buildPeriodKey, readPolicyConfig } from './helpers';

export interface BudgetCheckResult {
  allowed: boolean;
  code?: 'TOKEN_LIMIT' | 'COST_LIMIT' | 'REQUEST_LIMIT';
  period?: string;
  used?: number;
  limit?: number;
  reason?: string;
}

interface UsageTotals {
  totalTokens: number;
  costEstimate: number;
  requestCount: number;
}

/**
 * Collect ALL budget rules that apply to the given user/agent context.
 * Unlike the old `findApplicableRule`, every matching rule is returned
 * so that each one can be checked independently.
 */
function collectAllApplicableRules(
  rules: BudgetRule[],
  userId: string,
  agentTeamIds: string[],
  userRole?: string,
): BudgetRule[] {
  return rules.filter((r) => {
    switch (r.scope) {
      case 'user':
        return r.scopeId === userId;
      case 'team':
        return r.scopeId != null && agentTeamIds.includes(r.scopeId);
      case 'role':
        return userRole != null && r.scopeId === userRole;
      case 'default':
        return true;
      default:
        return false;
    }
  });
}

/**
 * Query the user's personal usage for a given period from the ledger.
 */
async function getUserPeriodUsage(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
  userId: string,
  periodKey: string,
): Promise<UsageTotals> {
  const entry = await ctx.db
    .query('usageLedger')
    .withIndex('by_org_user_period', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('userId', userId)
        .eq('periodKey', periodKey),
    )
    .first();

  if (!entry) {
    return { totalTokens: 0, costEstimate: 0, requestCount: 0 };
  }

  return {
    totalTokens: entry.totalTokens,
    costEstimate: entry.costEstimate,
    requestCount: entry.requestCount,
  };
}

/**
 * Query the combined usage of all members within a team for a given period.
 * Team budgets are shared caps — every member's usage counts toward the limit.
 */
async function getTeamPeriodUsage(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
  teamId: string,
  periodKey: string,
): Promise<UsageTotals> {
  const entries = await ctx.db
    .query('usageLedger')
    .withIndex('by_org_team_period', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('teamId', teamId)
        .eq('periodKey', periodKey),
    )
    .collect();

  const totals: UsageTotals = {
    totalTokens: 0,
    costEstimate: 0,
    requestCount: 0,
  };

  for (const entry of entries) {
    totals.totalTokens += entry.totalTokens;
    totals.costEstimate += entry.costEstimate;
    totals.requestCount += entry.requestCount;
  }

  return totals;
}

/**
 * Check a single rule against usage totals and return a violation result
 * if any limit is exceeded, or null if the rule passes.
 */
function checkRuleAgainstUsage(
  rule: BudgetRule,
  usage: UsageTotals,
): BudgetCheckResult | null {
  if (rule.maxTokens != null && usage.totalTokens >= rule.maxTokens) {
    return {
      allowed: false,
      code: 'TOKEN_LIMIT',
      period: rule.period,
      used: usage.totalTokens,
      limit: rule.maxTokens,
      reason: `Token limit reached for this ${rule.period} period (${usage.totalTokens.toLocaleString()} / ${rule.maxTokens.toLocaleString()})`,
    };
  }

  if (rule.maxCostCents != null && usage.costEstimate >= rule.maxCostCents) {
    return {
      allowed: false,
      code: 'COST_LIMIT',
      period: rule.period,
      used: usage.costEstimate,
      limit: rule.maxCostCents,
      reason: `Cost limit reached for this ${rule.period} period`,
    };
  }

  if (rule.maxRequests != null && usage.requestCount >= rule.maxRequests) {
    return {
      allowed: false,
      code: 'REQUEST_LIMIT',
      period: rule.period,
      used: usage.requestCount,
      limit: rule.maxRequests,
      reason: `Request limit reached for this ${rule.period} period (${usage.requestCount} / ${rule.maxRequests})`,
    };
  }

  return null;
}

/**
 * Check whether a user is within their budget limits.
 *
 * Reads the budgets governance policy and checks the user's current-period
 * usage against ALL applicable rules. If any rule is violated, access is denied.
 *
 * @param agentTeamIds - the agent's team tags (not the user's teams).
 *   Team budget rules only apply when the agent belongs to that team.
 */
export async function checkBudget(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
  userId: string,
  agentTeamIds: string[],
  userRole?: string,
): Promise<BudgetCheckResult> {
  const config = await readPolicyConfig<BudgetConfig>(
    ctx,
    organizationId,
    'budgets',
  );

  if (!config || !config.enabled || config.rules.length === 0) {
    return { allowed: true };
  }

  const rules = collectAllApplicableRules(
    config.rules,
    userId,
    agentTeamIds,
    userRole,
  );

  if (rules.length === 0) {
    return { allowed: true };
  }

  for (const rule of rules) {
    if (rule.period !== 'monthly') {
      console.warn(
        `[budget_enforcement] Skipping rule with unsupported period "${rule.period}" (scope=${rule.scope}, scopeId=${rule.scopeId ?? 'none'}). Only "monthly" is supported in v1.`,
      );
      continue;
    }

    const periodKey = buildPeriodKey(rule.period);

    let usage: UsageTotals;
    if (rule.scope === 'team' && rule.scopeId) {
      usage = await getTeamPeriodUsage(
        ctx,
        organizationId,
        rule.scopeId,
        periodKey,
      );
    } else {
      usage = await getUserPeriodUsage(ctx, organizationId, userId, periodKey);
    }

    const violation = checkRuleAgainstUsage(rule, usage);
    if (violation) {
      return violation;
    }
  }

  return { allowed: true };
}
