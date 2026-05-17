import type { GenericQueryCtx } from 'convex/server';

import type {
  BudgetConfig,
  BudgetRule,
} from '../../lib/shared/schemas/governance';
import type { DataModel } from '../_generated/dataModel';
import { buildPeriodKey, readPolicyConfig } from './helpers';

export interface BudgetWarning {
  code: 'TOKEN_WARNING' | 'COST_WARNING' | 'REQUEST_WARNING';
  period: string;
  used: number;
  limit: number;
  percent: number;
}

export interface BudgetCheckResult {
  allowed: boolean;
  code?: 'TOKEN_LIMIT' | 'COST_LIMIT' | 'REQUEST_LIMIT';
  period?: string;
  used?: number;
  limit?: number;
  reason?: string;
  warnings?: BudgetWarning[];
}

interface UsageTotals {
  totalTokens: number;
  costEstimate: number;
  requestCount: number;
}

export interface EffectiveLimits {
  maxTokens?: number;
  maxCostCents?: number;
  maxRequests?: number;
  orgMaxTokens?: number;
  orgMaxCostCents?: number;
  orgMaxRequests?: number;
  warningThresholdPercent?: number;
  orgWarningThresholdPercent?: number;
  /** Team IDs whose rules contributed to the effective limits (for aggregate checks). */
  effectiveTeamIds: string[];
}

/**
 * Collect ALL budget rules that apply to the given user/agent context.
 * Every matching rule is returned so that each one can be checked independently.
 */
export function collectAllApplicableRules(
  rules: BudgetRule[],
  userId: string,
  userTeamIds: string[],
  userRole?: string,
): BudgetRule[] {
  return rules.filter((r) => {
    switch (r.scope) {
      case 'user':
        return r.scopeId === userId;
      case 'team':
        return r.scopeId != null && userTeamIds.includes(r.scopeId);
      case 'role':
        return userRole != null && r.scopeId === userRole;
      case 'org':
        return true;
      case 'default':
        return true;
      default:
        return false;
    }
  });
}

/**
 * Resolve effective budget limits using priority: user > team > role > default.
 *
 * Each limit field (maxTokens, maxCostCents, maxRequests) is resolved independently
 * from the most specific scope that defines it. This allows granular overrides:
 * e.g. a user-level token limit with a team-level cost cap.
 *
 * Org-scoped limits are resolved separately because they represent aggregate caps
 * that always apply in addition to per-user limits.
 *
 * For multi-team users, the most permissive (highest) team limit wins.
 */
export function resolveEffectiveLimits(
  rules: BudgetRule[],
  userId: string,
  userTeamIds: string[],
  userRole?: string,
): EffectiveLimits {
  const userRules = rules.filter(
    (r) => r.scope === 'user' && r.scopeId === userId,
  );
  const teamRules = rules.filter(
    (r) =>
      r.scope === 'team' &&
      r.scopeId != null &&
      userTeamIds.includes(r.scopeId),
  );
  const roleRules = userRole
    ? rules.filter((r) => r.scope === 'role' && r.scopeId === userRole)
    : [];
  const defaultRules = rules.filter((r) => r.scope === 'default');
  const orgRules = rules.filter((r) => r.scope === 'org');

  // Priority tiers for per-user limits: user > team > role > default
  const tiers = [userRules, teamRules, roleRules, defaultRules];
  const teamTierIndex = 1;
  const fieldsFromTeam = new Set<string>();

  function resolveField(
    field: 'maxTokens' | 'maxCostCents' | 'maxRequests',
  ): number | undefined {
    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i];
      const values = tier
        .map((r) => r[field])
        .filter((v): v is number => v != null);
      if (values.length > 0) {
        if (i === teamTierIndex) fieldsFromTeam.add(field);
        // For team tier with multiple matching teams, use the most permissive (highest)
        return Math.max(...values);
      }
    }
    return undefined;
  }

  function resolveWarningThreshold(): number | undefined {
    for (const tier of tiers) {
      const values = tier
        .map((r) => r.warningThresholdPercent)
        .filter((v): v is number => v != null);
      if (values.length > 0) {
        return Math.min(...values);
      }
    }
    return undefined;
  }

  const orgMaxTokens = orgRules
    .map((r) => r.maxTokens)
    .filter((v): v is number => v != null)
    .reduce<number | undefined>(
      (acc, v) => (acc == null ? v : Math.min(acc, v)),
      undefined,
    );
  const orgMaxCostCents = orgRules
    .map((r) => r.maxCostCents)
    .filter((v): v is number => v != null)
    .reduce<number | undefined>(
      (acc, v) => (acc == null ? v : Math.min(acc, v)),
      undefined,
    );
  const orgMaxRequests = orgRules
    .map((r) => r.maxRequests)
    .filter((v): v is number => v != null)
    .reduce<number | undefined>(
      (acc, v) => (acc == null ? v : Math.min(acc, v)),
      undefined,
    );
  const orgWarningThreshold = orgRules
    .map((r) => r.warningThresholdPercent)
    .filter((v): v is number => v != null)
    .reduce<number | undefined>(
      (acc, v) => (acc == null ? v : Math.min(acc, v)),
      undefined,
    );

  const maxTokens = resolveField('maxTokens');
  const maxCostCents = resolveField('maxCostCents');
  const maxRequests = resolveField('maxRequests');

  // Collect unique team IDs from team rules when any field was resolved from the team tier
  const effectiveTeamIds =
    fieldsFromTeam.size > 0
      ? [
          ...new Set(
            teamRules
              .map((r) => r.scopeId)
              .filter((id): id is string => id != null),
          ),
        ]
      : [];

  return {
    maxTokens,
    maxCostCents,
    maxRequests,
    orgMaxTokens,
    orgMaxCostCents,
    orgMaxRequests,
    warningThresholdPercent: resolveWarningThreshold(),
    orgWarningThresholdPercent: orgWarningThreshold,
    effectiveTeamIds,
  };
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
  const totals: UsageTotals = {
    totalTokens: 0,
    costEstimate: 0,
    requestCount: 0,
  };

  for await (const entry of ctx.db
    .query('usageLedger')
    .withIndex('by_org_user_period', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('userId', userId)
        .eq('periodKey', periodKey),
    )) {
    totals.totalTokens += entry.totalTokens;
    totals.costEstimate += entry.costEstimate;
    totals.requestCount += entry.requestCount;
  }

  return totals;
}

/**
 * Query the combined usage of all members within a team for a given period.
 * Team budgets are shared caps -- every member's usage counts toward the limit.
 */
async function getTeamPeriodUsage(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
  teamId: string,
  periodKey: string,
): Promise<UsageTotals> {
  const totals: UsageTotals = {
    totalTokens: 0,
    costEstimate: 0,
    requestCount: 0,
  };

  for await (const entry of ctx.db
    .query('usageLedger')
    .withIndex('by_org_team_period', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('teamId', teamId)
        .eq('periodKey', periodKey),
    )) {
    totals.totalTokens += entry.totalTokens;
    totals.costEstimate += entry.costEstimate;
    totals.requestCount += entry.requestCount;
  }

  return totals;
}

/**
 * Query the organization-wide aggregate usage for a given period.
 */
async function getOrgPeriodUsage(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
  periodKey: string,
): Promise<UsageTotals> {
  const totals: UsageTotals = {
    totalTokens: 0,
    costEstimate: 0,
    requestCount: 0,
  };

  for await (const entry of ctx.db
    .query('usageLedger')
    .withIndex('by_org_period', (q) =>
      q.eq('organizationId', organizationId).eq('periodKey', periodKey),
    )) {
    totals.totalTokens += entry.totalTokens;
    totals.costEstimate += entry.costEstimate;
    totals.requestCount += entry.requestCount;
  }

  return totals;
}

/**
 * Check a single rule against usage totals and return a violation result
 * if any limit is exceeded, or null if the rule passes.
 *
 * `prospectiveCostCents` adds an in-flight cost estimate to `usage.costEstimate`
 * before comparing against `maxCostCents`. Callers thread this through when the
 * ledger is written *after* the work runs (e.g. TTS — the ledger row only
 * lands after `ctx.storage.store` succeeds), so the retrospective totals miss
 * the call about to fire. Without the prospective add, parallel chunks of a
 * single message can each individually pass the cap and then collectively
 * blow past it — exactly the round-2 file 03 finding 1 hazard.
 *
 * Residual race (documented, not closed): N concurrent `reserveChunk` calls
 * that all read totals before any of them writes a ledger row will each see
 * `usage.costEstimate` at the same value and each project only their own
 * prospective add. Convex serialises mutations on the SAME aggregate row via
 * OCC retry, so the race only surfaces when the aggregate row doesn't yet
 * exist for the period (first call after midnight, etc.) — in that case the
 * 10-racer-each-with-6¢-chunk worst case in round-1 finding 11-H1 is bounded
 * by the per-message char cap (`MAX_TTS_CHARS_PER_MESSAGE = 50_000` in
 * `lib/shared/constants/tts.ts`) and the client's `MAX_IN_FLIGHT = 3`. Worst
 * case overshoot per assistant reply at OpenAI tts-1 rates: ~8¢. Acceptable
 * for demo-stage. The structural fix (per-chunk provisional ledger row that
 * a) is visible to subsequent reservations and b) is patched/dropped on
 * mark-ready/mark-failed) is tracked as a follow-up issue.
 */
export function checkRuleAgainstUsage(
  rule: BudgetRule,
  usage: UsageTotals,
  prospectiveCostCents: number = 0,
  prospectiveRequests: number = 0,
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

  const projectedCost = usage.costEstimate + prospectiveCostCents;
  if (rule.maxCostCents != null && projectedCost >= rule.maxCostCents) {
    return {
      allowed: false,
      code: 'COST_LIMIT',
      period: rule.period,
      used: projectedCost,
      limit: rule.maxCostCents,
      reason: `Cost limit reached for this ${rule.period} period ($${(projectedCost / 100).toFixed(2)} / $${(rule.maxCostCents / 100).toFixed(2)})`,
    };
  }

  // `prospectiveRequests` mirrors `prospectiveCostCents`: TTS callers
  // pass 1 for the about-to-fire chunk so parallel chunks of a single
  // message can't each individually pass the cap and collectively
  // overshoot. LLM callers leave it at 0 — their ledger write is
  // synchronous with the call so retrospective checks are accurate.
  const projectedRequests = usage.requestCount + prospectiveRequests;
  if (rule.maxRequests != null && projectedRequests >= rule.maxRequests) {
    return {
      allowed: false,
      code: 'REQUEST_LIMIT',
      period: rule.period,
      used: projectedRequests,
      limit: rule.maxRequests,
      reason: `Request limit reached for this ${rule.period} period (${projectedRequests} / ${rule.maxRequests})`,
    };
  }

  return null;
}

/**
 * Collect warnings for usage that exceeds the warning threshold but is still
 * allowed. The cost-warning includes `prospectiveCostCents` in the
 * projection so a TTS chunk that would push usage past the warning
 * threshold (but stays under the hard cap) emits a `COST_WARNING` — without
 * the projection, the warning UX silently drops for exactly the parallel-
 * chunks scenario the prospective add was introduced to fix. Token /
 * request warnings are unchanged because no caller plumbs prospective
 * tokens or requests.
 */
function collectWarnings(
  limits: EffectiveLimits,
  usage: UsageTotals,
  period: string,
  prospectiveCostCents: number = 0,
  prospectiveRequests: number = 0,
): BudgetWarning[] {
  const threshold = limits.warningThresholdPercent;
  if (threshold == null) return [];

  const warnings: BudgetWarning[] = [];

  if (limits.maxTokens != null) {
    const percent = (usage.totalTokens / limits.maxTokens) * 100;
    if (percent >= threshold && usage.totalTokens < limits.maxTokens) {
      warnings.push({
        code: 'TOKEN_WARNING',
        period,
        used: usage.totalTokens,
        limit: limits.maxTokens,
        percent: Math.round(percent),
      });
    }
  }

  if (limits.maxCostCents != null) {
    const projectedCost = usage.costEstimate + prospectiveCostCents;
    const percent = (projectedCost / limits.maxCostCents) * 100;
    if (percent >= threshold && projectedCost < limits.maxCostCents) {
      warnings.push({
        code: 'COST_WARNING',
        period,
        used: projectedCost,
        limit: limits.maxCostCents,
        percent: Math.round(percent),
      });
    }
  }

  if (limits.maxRequests != null) {
    const projectedRequests = usage.requestCount + prospectiveRequests;
    const percent = (projectedRequests / limits.maxRequests) * 100;
    if (percent >= threshold && projectedRequests < limits.maxRequests) {
      warnings.push({
        code: 'REQUEST_WARNING',
        period,
        used: projectedRequests,
        limit: limits.maxRequests,
        percent: Math.round(percent),
      });
    }
  }

  return warnings;
}

/**
 * Check whether a user is within their budget limits.
 *
 * Reads the budgets governance policy and resolves effective limits using
 * priority: user > team > role > default. Each limit field is resolved
 * independently from the most specific scope that defines it.
 *
 * Org-scoped limits are checked separately against aggregate org usage.
 *
 * @param userTeamIds - the user's team memberships (not the agent's teams).
 *   Team budget rules apply when the user belongs to that team.
 * @param userRole - the user's role in the organization (e.g. 'admin', 'member').
 * @param prospectiveCostCents - in-flight cost estimate (post-ledger callers
 *   like TTS pass the about-to-fire chunk's cost so parallel chunks of one
 *   message can't each individually pass the cap and collectively overshoot).
 *   LLM callers leave at 0; the synchronous post-call ledger write is
 *   "atomic enough" for retrospective checks against the cap.
 * @param prospectiveRequests - mirror of `prospectiveCostCents` for the
 *   request-count axis. TTS callers pass 1 so an admin who set
 *   `maxRequests` for the period sees parallel chunks honour the cap.
 *   LLM callers leave at 0.
 */
export async function checkBudget(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
  userId: string,
  userTeamIds: string[],
  userRole?: string,
  prospectiveCostCents: number = 0,
  prospectiveRequests: number = 0,
): Promise<BudgetCheckResult> {
  const config = await readPolicyConfig<BudgetConfig>(
    ctx,
    organizationId,
    'budgets',
  );

  if (!config || !config.enabled || config.rules.length === 0) {
    return { allowed: true };
  }

  const applicableRules = collectAllApplicableRules(
    config.rules,
    userId,
    userTeamIds,
    userRole,
  );

  if (applicableRules.length === 0) {
    return { allowed: true };
  }

  // Group rules by period so each period is enforced independently
  type Period = 'daily' | 'weekly' | 'monthly';
  const rulesByPeriod = new Map<Period, BudgetRule[]>();
  for (const rule of applicableRules) {
    const existing = rulesByPeriod.get(rule.period);
    if (existing) {
      existing.push(rule);
    } else {
      rulesByPeriod.set(rule.period, [rule]);
    }
  }

  const allWarnings: BudgetWarning[] = [];

  for (const [period, periodRules] of rulesByPeriod) {
    const periodKey = buildPeriodKey(period);

    // Resolve effective per-user limits for this period
    const limits = resolveEffectiveLimits(
      periodRules,
      userId,
      userTeamIds,
      userRole,
    );

    // Check per-user limits against user's personal usage
    const userUsage = await getUserPeriodUsage(
      ctx,
      organizationId,
      userId,
      periodKey,
    );

    const effectiveRule: BudgetRule = {
      scope: 'default',
      period: period,
      maxTokens: limits.maxTokens,
      maxCostCents: limits.maxCostCents,
      maxRequests: limits.maxRequests,
    };
    const violation = checkRuleAgainstUsage(
      effectiveRule,
      userUsage,
      prospectiveCostCents,
      prospectiveRequests,
    );
    if (violation) {
      return {
        ...violation,
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
      };
    }

    // Collect warnings for approaching limits
    allWarnings.push(
      ...collectWarnings(
        limits,
        userUsage,
        period,
        prospectiveCostCents,
        prospectiveRequests,
      ),
    );

    // Check team aggregate usage when limits came from team-scoped rules
    for (const teamId of limits.effectiveTeamIds) {
      const teamUsage = await getTeamPeriodUsage(
        ctx,
        organizationId,
        teamId,
        periodKey,
      );
      const teamRule: BudgetRule = {
        scope: 'team',
        scopeId: teamId,
        period: period,
        maxTokens: limits.maxTokens,
        maxCostCents: limits.maxCostCents,
        maxRequests: limits.maxRequests,
      };
      const teamViolation = checkRuleAgainstUsage(
        teamRule,
        teamUsage,
        prospectiveCostCents,
        prospectiveRequests,
      );
      if (teamViolation) {
        return {
          ...teamViolation,
          warnings: allWarnings.length > 0 ? allWarnings : undefined,
        };
      }
    }

    // Check org-scoped limits against org-wide aggregate usage
    if (
      limits.orgMaxTokens != null ||
      limits.orgMaxCostCents != null ||
      limits.orgMaxRequests != null
    ) {
      const orgUsage = await getOrgPeriodUsage(ctx, organizationId, periodKey);
      const orgRule: BudgetRule = {
        scope: 'org',
        period: period,
        maxTokens: limits.orgMaxTokens,
        maxCostCents: limits.orgMaxCostCents,
        maxRequests: limits.orgMaxRequests,
      };
      const orgViolation = checkRuleAgainstUsage(
        orgRule,
        orgUsage,
        prospectiveCostCents,
        prospectiveRequests,
      );
      if (orgViolation) {
        return {
          ...orgViolation,
          reason: `Organization-wide ${orgViolation.reason}`,
          warnings: allWarnings.length > 0 ? allWarnings : undefined,
        };
      }
    }
  }

  return {
    allowed: true,
    warnings: allWarnings.length > 0 ? allWarnings : undefined,
  };
}
