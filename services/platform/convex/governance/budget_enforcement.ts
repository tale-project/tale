import type { GenericQueryCtx } from 'convex/server';

import type {
  BudgetConfig,
  BudgetRule,
} from '../../lib/shared/schemas/governance';
import type { DataModel } from '../_generated/dataModel';
import { buildPeriodKey, readPolicyConfig } from './helpers';

interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
}

interface UsageTotals {
  totalTokens: number;
  costEstimate: number;
  requestCount: number;
}

/**
 * Find the most specific budget rule that applies to this user.
 * Priority: user > team > role > default
 */
function findApplicableRule(
  rules: BudgetRule[],
  userId: string,
  teamIds: string[],
  userRole?: string,
): BudgetRule | null {
  const userRule = rules.find(
    (r) => r.scope === 'user' && r.scopeId === userId,
  );
  if (userRule) return userRule;

  const teamRule = rules.find(
    (r) => r.scope === 'team' && r.scopeId && teamIds.includes(r.scopeId),
  );
  if (teamRule) return teamRule;

  if (userRole) {
    const roleRule = rules.find(
      (r) => r.scope === 'role' && r.scopeId === userRole,
    );
    if (roleRule) return roleRule;
  }

  return rules.find((r) => r.scope === 'default') ?? null;
}

/**
 * Query the user's usage for a given period from the ledger.
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
 * Check whether a user is within their budget limits.
 *
 * Reads the budgets governance policy and compares the user's
 * current-period usage against the most specific applicable rule.
 */
export async function checkBudget(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
  userId: string,
  teamIds: string[],
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

  const rule = findApplicableRule(config.rules, userId, teamIds, userRole);
  if (!rule) {
    return { allowed: true };
  }

  const periodKey = buildPeriodKey(rule.period);
  const usage = await getUserPeriodUsage(
    ctx,
    organizationId,
    userId,
    periodKey,
  );

  if (rule.maxTokens != null && usage.totalTokens >= rule.maxTokens) {
    return {
      allowed: false,
      reason: `Token limit reached for this ${rule.period} period (${usage.totalTokens.toLocaleString()} / ${rule.maxTokens.toLocaleString()})`,
    };
  }

  if (rule.maxCostCents != null && usage.costEstimate >= rule.maxCostCents) {
    return {
      allowed: false,
      reason: `Cost limit reached for this ${rule.period} period`,
    };
  }

  if (rule.maxRequests != null && usage.requestCount >= rule.maxRequests) {
    return {
      allowed: false,
      reason: `Request limit reached for this ${rule.period} period (${usage.requestCount} / ${rule.maxRequests})`,
    };
  }

  return { allowed: true };
}
