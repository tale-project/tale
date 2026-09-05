import type { BudgetRule } from '../../../lib/shared/schemas/governance';

/** Whose bucket a warning is about: the caller's own usage, the whole
 * organization's, or the authenticating API key's. */
export type BudgetWarningScope = 'user' | 'org' | 'apiKey';

export interface BudgetWarning {
  code: 'TOKEN_WARNING' | 'COST_WARNING' | 'REQUEST_WARNING';
  scope: BudgetWarningScope;
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
  /**
   * Per-API-key caps, resolved independently from the per-user/org tiers (an
   * `apiKey`-scoped rule matching the request's key). Like org limits, these are
   * an ADDITIONAL bucket checked against the key's own usage — a per-key cap
   * binds even when the owner's user cap is higher, which is the whole point of
   * budgeting a single credential. Undefined when no apiKey rule matched.
   */
  apiKeyMaxTokens?: number;
  apiKeyMaxCostCents?: number;
  apiKeyMaxRequests?: number;
  warningThresholdPercent?: number;
  orgWarningThresholdPercent?: number;
  apiKeyWarningThresholdPercent?: number;
  /**
   * The SHARED caps of every team the user belongs to that carries a rule —
   * each team's own limit values, measured against that team's aggregate
   * usage. Kept apart from the per-user triple above on purpose: a cap
   * resolved from the user/role/default tier is a personal cap and must never
   * be measured against a whole team's spend, and a team's shared cap stays
   * in force for a member whose personal cap comes from a narrower rule.
   */
  teamLimits: TeamLimits[];
}

/** One team's shared caps for the period (its own rule values, tightest per
 * field when several of its rules name the same period). */
export interface TeamLimits {
  teamId: string;
  maxTokens?: number;
  maxCostCents?: number;
  maxRequests?: number;
}

/** True when the team declares at least one cap worth an aggregate read. */
export function teamLimitsHasCap(limits: TeamLimits): boolean {
  return (
    limits.maxTokens != null ||
    limits.maxCostCents != null ||
    limits.maxRequests != null
  );
}

/**
 * Collect ALL budget rules that apply to the given user/agent context.
 * Every matching rule is returned so that each one can be checked independently.
 *
 * `apiKeyId` is the Better Auth `apikey._id` of the credential that
 * authenticated the request (openai-compat path). An `apiKey`-scoped rule only
 * applies when its `apiKeyId` matches — so a request made WITHOUT an API key
 * (in-app chat, `apiKeyId` undefined) never matches any per-key rule, and a
 * request made WITH key A never matches key B's rule.
 */
export function collectAllApplicableRules(
  rules: BudgetRule[],
  userId: string,
  userTeamIds: string[],
  userRole?: string,
  apiKeyId?: string,
): BudgetRule[] {
  return rules.filter((r) => {
    switch (r.scope) {
      case 'user':
        return r.scopeId === userId;
      case 'team':
        return r.scopeId != null && userTeamIds.includes(r.scopeId);
      case 'role':
        return userRole != null && r.scopeId === userRole;
      case 'apiKey':
        return apiKeyId != null && r.apiKeyId === apiKeyId;
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
 * `apiKey`-scoped limits are ALSO resolved separately (like org): a per-key cap
 * is an independent bucket checked against the authenticating key's own usage,
 * so it binds regardless of how high the owner's user/team/org caps are.
 *
 * For multi-team users, the most permissive (highest) team limit wins the
 * PERSONAL tier. Each team's own values are ALSO returned as that team's
 * shared cap (`teamLimits`) — the aggregate check measures a team's rule
 * against the team's usage and nothing else, whichever tier the personal
 * triple came from.
 */
export function resolveEffectiveLimits(
  rules: BudgetRule[],
  userId: string,
  userTeamIds: string[],
  userRole?: string,
  apiKeyId?: string,
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
  const apiKeyRules =
    apiKeyId != null
      ? rules.filter((r) => r.scope === 'apiKey' && r.apiKeyId === apiKeyId)
      : [];

  // Priority tiers for per-user limits: user > team > role > default
  const tiers = [userRules, teamRules, roleRules, defaultRules];

  function resolveField(
    field: 'maxTokens' | 'maxCostCents' | 'maxRequests',
  ): number | undefined {
    for (const tier of tiers) {
      const values = tier
        .map((r) => r[field])
        .filter((v): v is number => v != null);
      if (values.length > 0) {
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

  const minNonNull = (
    values: Array<number | null | undefined>,
  ): number | undefined =>
    values
      .filter((v): v is number => v != null)
      .reduce<number | undefined>(
        (acc, v) => (acc == null ? v : Math.min(acc, v)),
        undefined,
      );
  const orgMaxTokens = minNonNull(orgRules.map((r) => r.maxTokens));
  const orgMaxCostCents = minNonNull(orgRules.map((r) => r.maxCostCents));
  const orgMaxRequests = minNonNull(orgRules.map((r) => r.maxRequests));
  const orgWarningThreshold = minNonNull(
    orgRules.map((r) => r.warningThresholdPercent),
  );

  // Per-API-key caps: tightest (min) across every apiKey rule that matched the
  // request's key. Independent of the per-user/org tiers above.
  const apiKeyMaxTokens = minNonNull(apiKeyRules.map((r) => r.maxTokens));
  const apiKeyMaxCostCents = minNonNull(apiKeyRules.map((r) => r.maxCostCents));
  const apiKeyMaxRequests = minNonNull(apiKeyRules.map((r) => r.maxRequests));
  const apiKeyWarningThreshold = minNonNull(
    apiKeyRules.map((r) => r.warningThresholdPercent),
  );

  const maxTokens = resolveField('maxTokens');
  const maxCostCents = resolveField('maxCostCents');
  const maxRequests = resolveField('maxRequests');

  // Each team's SHARED caps, from that team's rules alone (tightest per
  // field when a team carries several rules for the period) — never the
  // mixed personal triple, and never dropped because a narrower rule won a
  // personal field.
  const teamLimitsById = new Map<string, TeamLimits>();
  for (const rule of teamRules) {
    if (rule.scopeId == null) continue;
    const current = teamLimitsById.get(rule.scopeId) ?? {
      teamId: rule.scopeId,
    };
    const merged: TeamLimits = { teamId: rule.scopeId };
    const teamTokens = minNonNull([current.maxTokens, rule.maxTokens]);
    const teamCost = minNonNull([current.maxCostCents, rule.maxCostCents]);
    const teamRequests = minNonNull([current.maxRequests, rule.maxRequests]);
    if (teamTokens !== undefined) merged.maxTokens = teamTokens;
    if (teamCost !== undefined) merged.maxCostCents = teamCost;
    if (teamRequests !== undefined) merged.maxRequests = teamRequests;
    teamLimitsById.set(rule.scopeId, merged);
  }
  const teamLimits = [...teamLimitsById.values()];

  return {
    maxTokens,
    maxCostCents,
    maxRequests,
    orgMaxTokens,
    orgMaxCostCents,
    orgMaxRequests,
    apiKeyMaxTokens,
    apiKeyMaxCostCents,
    apiKeyMaxRequests,
    warningThresholdPercent: resolveWarningThreshold(),
    orgWarningThresholdPercent: orgWarningThreshold,
    apiKeyWarningThresholdPercent: apiKeyWarningThreshold,
    teamLimits,
  };
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
export function collectWarnings(
  limits: EffectiveLimits,
  usage: UsageTotals,
  period: string,
  prospectiveCostCents: number = 0,
  prospectiveRequests: number = 0,
): BudgetWarning[] {
  return collectBucketWarnings(
    'user',
    limits.warningThresholdPercent,
    limits,
    usage,
    period,
    prospectiveCostCents,
    prospectiveRequests,
  );
}

/**
 * The org bucket's warnings: the organization-wide caps measured against
 * the organization's aggregate usage, at the threshold the org-scoped rules
 * set. Regression: `orgWarningThresholdPercent` was resolved and never read,
 * so "warn at 80% of the org cap" did nothing — the org budget went from
 * silent straight to hard-blocked.
 */
export function collectOrgWarnings(
  limits: EffectiveLimits,
  orgUsage: UsageTotals,
  period: string,
  prospectiveCostCents: number = 0,
  prospectiveRequests: number = 0,
): BudgetWarning[] {
  return collectBucketWarnings(
    'org',
    limits.orgWarningThresholdPercent,
    {
      maxTokens: limits.orgMaxTokens,
      maxCostCents: limits.orgMaxCostCents,
      maxRequests: limits.orgMaxRequests,
    },
    orgUsage,
    period,
    prospectiveCostCents,
    prospectiveRequests,
  );
}

/** The API key's own bucket — its caps against its own usage, at the
 * threshold its `apiKey`-scoped rules set. */
export function collectApiKeyWarnings(
  limits: EffectiveLimits,
  keyUsage: UsageTotals,
  period: string,
  prospectiveCostCents: number = 0,
  prospectiveRequests: number = 0,
): BudgetWarning[] {
  return collectBucketWarnings(
    'apiKey',
    limits.apiKeyWarningThresholdPercent,
    {
      maxTokens: limits.apiKeyMaxTokens,
      maxCostCents: limits.apiKeyMaxCostCents,
      maxRequests: limits.apiKeyMaxRequests,
    },
    keyUsage,
    period,
    prospectiveCostCents,
    prospectiveRequests,
  );
}

/** One bucket's caps — the triple a warning is measured against. */
interface WarningBucketCaps {
  maxTokens?: number | undefined;
  maxCostCents?: number | undefined;
  maxRequests?: number | undefined;
}

/**
 * The one warning rule, over any bucket: a cap the usage has reached
 * `threshold` percent of, but not yet exceeded. No threshold, no warnings —
 * a rule that sets caps without `warningThresholdPercent` asked for a hard
 * stop only.
 */
export function collectBucketWarnings(
  scope: BudgetWarningScope,
  threshold: number | undefined,
  caps: WarningBucketCaps,
  usage: UsageTotals,
  period: string,
  prospectiveCostCents: number = 0,
  prospectiveRequests: number = 0,
): BudgetWarning[] {
  if (threshold == null) return [];

  const warnings: BudgetWarning[] = [];

  if (caps.maxTokens != null) {
    const percent = (usage.totalTokens / caps.maxTokens) * 100;
    if (percent >= threshold && usage.totalTokens < caps.maxTokens) {
      warnings.push({
        code: 'TOKEN_WARNING',
        scope,
        period,
        used: usage.totalTokens,
        limit: caps.maxTokens,
        percent: Math.round(percent),
      });
    }
  }

  if (caps.maxCostCents != null) {
    const projectedCost = usage.costEstimate + prospectiveCostCents;
    const percent = (projectedCost / caps.maxCostCents) * 100;
    if (percent >= threshold && projectedCost < caps.maxCostCents) {
      warnings.push({
        code: 'COST_WARNING',
        scope,
        period,
        used: projectedCost,
        limit: caps.maxCostCents,
        percent: Math.round(percent),
      });
    }
  }

  if (caps.maxRequests != null) {
    const projectedRequests = usage.requestCount + prospectiveRequests;
    const percent = (projectedRequests / caps.maxRequests) * 100;
    if (percent >= threshold && projectedRequests < caps.maxRequests) {
      warnings.push({
        code: 'REQUEST_WARNING',
        scope,
        period,
        used: projectedRequests,
        limit: caps.maxRequests,
        percent: Math.round(percent),
      });
    }
  }

  return warnings;
}
