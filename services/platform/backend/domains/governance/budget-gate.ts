import type { BudgetRule } from '@tale/shared/schemas/governance';
import type { Sql, TransactionSql } from 'postgres';

import {
  type BudgetCheckResult,
  checkRuleAgainstUsage,
  collectAllApplicableRules,
  resolveEffectiveLimits,
  teamLimitsHasCap,
} from '../../core/governance/budget_enforcement.ts';
import {
  buildPeriodEndFromTimestamp,
  buildPeriodKeyFromTimestamp,
} from '../../core/governance/helpers.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';

/**
 * The org budget gate over the policy FILE + `app.usage_ledger`, with the
 * pure rule collectors/evaluators reused — ONE evaluation for every lane
 * that spends on the org's behalf: the TTS/transcription reservations, the
 * budget-status banner, the member's usage page, and the managed harness
 * turns (project agents, automation agent nodes). The api-key bucket is
 * omitted: none of these lanes carries one (the REST lane's budget wiring
 * rides its own increment).
 */

interface UsageTotals {
  totalTokens: number;
  costEstimate: number;
  requestCount: number;
}

export async function periodUsage(
  sql: Sql | TransactionSql,
  organizationId: string,
  periodKey: string,
  scope: { userId?: string; teamId?: string },
): Promise<UsageTotals> {
  const rows = await sql<
    { totalTokens: number; costEstimate: number; requestCount: number }[]
  >`
    SELECT coalesce(sum(total_tokens), 0)::float8 AS "totalTokens",
           coalesce(sum(cost_estimate_cents), 0)::float8 AS "costEstimate",
           coalesce(sum(request_count), 0)::float8 AS "requestCount"
    FROM app.usage_ledger
    WHERE org_id = ${organizationId} AND period_key = ${periodKey}
      AND (${scope.userId ?? null}::text IS NULL
        OR user_id = ${scope.userId ?? null})
      AND (${scope.teamId ?? null}::text IS NULL
        OR team_id = ${scope.teamId ?? null})
  `;
  return rows[0] ?? { totalTokens: 0, costEstimate: 0, requestCount: 0 };
}

type Limits = ReturnType<typeof resolveEffectiveLimits>;
function limitsTriple(limits: Limits) {
  return {
    maxTokens: limits.maxTokens,
    maxCostCents: limits.maxCostCents,
    maxRequests: limits.maxRequests,
  };
}

export interface OrgBudgetSubject {
  organizationId: string;
  userId: string;
  userTeamIds: string[];
  userRole?: string;
}

/** The buckets one evaluation walks, in the order the ladder binds: the
 * caller's personal triple, each of their teams' shared caps, the org's. */
interface BudgetBucket {
  rule: BudgetRule;
  usage: UsageTotals;
}

async function bucketsFor(
  sql: Sql | TransactionSql,
  subject: OrgBudgetSubject,
  period: BudgetRule['period'],
  limits: Limits,
  reserved: { orgCents: number; userCents: number },
  now: number = Date.now(),
): Promise<BudgetBucket[]> {
  const periodKey = buildPeriodKeyFromTimestamp(period, now);
  const withReservation = (usage: UsageTotals, cents: number) =>
    cents > 0 ? { ...usage, costEstimate: usage.costEstimate + cents } : usage;
  const buckets: BudgetBucket[] = [];
  buckets.push({
    rule: { scope: 'default', period, ...limitsTriple(limits) },
    usage: withReservation(
      await periodUsage(sql, subject.organizationId, periodKey, {
        userId: subject.userId,
      }),
      reserved.userCents,
    ),
  });
  // Each team's SHARED cap against that team's aggregate — the team rule's
  // own values, never the personal triple (see `EffectiveLimits.teamLimits`).
  for (const teamLimit of limits.teamLimits) {
    if (!teamLimitsHasCap(teamLimit)) continue;
    buckets.push({
      rule: {
        scope: 'team',
        scopeId: teamLimit.teamId,
        period,
        maxTokens: teamLimit.maxTokens,
        maxCostCents: teamLimit.maxCostCents,
        maxRequests: teamLimit.maxRequests,
      },
      usage: await periodUsage(sql, subject.organizationId, periodKey, {
        teamId: teamLimit.teamId,
      }),
    });
  }
  if (
    limits.orgMaxTokens != null ||
    limits.orgMaxCostCents != null ||
    limits.orgMaxRequests != null
  ) {
    buckets.push({
      rule: {
        scope: 'org',
        period,
        maxTokens: limits.orgMaxTokens,
        maxCostCents: limits.orgMaxCostCents,
        maxRequests: limits.orgMaxRequests,
      },
      usage: withReservation(
        await periodUsage(sql, subject.organizationId, periodKey, {}),
        reserved.orgCents,
      ),
    });
  }
  return buckets;
}

/**
 * Whether the subject may spend `prospectiveCostCents` more (and make
 * `prospectiveRequests` more calls) this period, under every rule that
 * applies to them. `{ allowed: true }` when no budget policy binds.
 */
export async function checkOrgBudget(
  sql: Sql | TransactionSql,
  args: OrgBudgetSubject & {
    prospectiveCostCents: number;
    prospectiveRequests: number;
  },
): Promise<BudgetCheckResult> {
  const config = await readGovernancePolicyForOrg(
    sql,
    args.organizationId,
    'budgets',
  );
  if (!config || !config.enabled || config.rules.length === 0) {
    return { allowed: true };
  }
  const applicableRules = collectAllApplicableRules(
    config.rules,
    args.userId,
    args.userTeamIds,
    args.userRole,
    undefined,
  );
  if (applicableRules.length === 0) return { allowed: true };

  for (const period of new Set(applicableRules.map((rule) => rule.period))) {
    const periodRules = applicableRules.filter((r) => r.period === period);
    const limits = resolveEffectiveLimits(
      periodRules,
      args.userId,
      args.userTeamIds,
      args.userRole,
      undefined,
    );
    for (const bucket of await bucketsFor(sql, args, period, limits, {
      orgCents: 0,
      userCents: 0,
    })) {
      const violation = checkRuleAgainstUsage(
        bucket.rule,
        bucket.usage,
        args.prospectiveCostCents,
        args.prospectiveRequests,
      );
      if (violation) return violation;
    }
  }
  return { allowed: true };
}

/** One cap that binds the subject this period and the usage the gate
 * measures it against. */
export interface BudgetStanding {
  /** Whose usage counts: the subject's own, one of their teams' combined
   * usage, or the whole organization's. */
  scope: 'user' | 'team' | 'org';
  /** The team whose shared cap this is — team scope only. */
  teamId?: string;
  period: BudgetRule['period'];
  periodKey: string;
  /** When the period rolls over and this usage starts again from zero. */
  resetsAt: number;
  /** The share of a cap the budget banner starts warning at, when a rule
   * for this bucket sets one (team shared caps have none). */
  warningThresholdPercent?: number;
  maxTokens?: number;
  maxCostCents?: number;
  maxRequests?: number;
  usage: UsageTotals;
}

const PERIODS: readonly BudgetRule['period'][] = ['daily', 'weekly', 'monthly'];

/**
 * Every cap that binds the subject, with what has been used against it this
 * period — the same buckets `checkOrgBudget` walks, read without a
 * prospective spend, so a reader sees exactly the numbers that would refuse
 * their next request. Only buckets that carry a cap are returned; `[]` when
 * no budget policy binds.
 */
export async function readBudgetStanding(
  sql: Sql | TransactionSql,
  subject: OrgBudgetSubject,
  now: number = Date.now(),
): Promise<BudgetStanding[]> {
  const config = await readGovernancePolicyForOrg(
    sql,
    subject.organizationId,
    'budgets',
  );
  if (!config || !config.enabled || config.rules.length === 0) return [];
  const applicableRules = collectAllApplicableRules(
    config.rules,
    subject.userId,
    subject.userTeamIds,
    subject.userRole,
    undefined,
  );

  const standings: BudgetStanding[] = [];
  for (const period of PERIODS) {
    const periodRules = applicableRules.filter((r) => r.period === period);
    if (periodRules.length === 0) continue;
    const limits = resolveEffectiveLimits(
      periodRules,
      subject.userId,
      subject.userTeamIds,
      subject.userRole,
      undefined,
    );
    const buckets = await bucketsFor(
      sql,
      subject,
      period,
      limits,
      { orgCents: 0, userCents: 0 },
      now,
    );
    for (const { rule, usage } of buckets) {
      if (
        rule.maxTokens == null &&
        rule.maxCostCents == null &&
        rule.maxRequests == null
      ) {
        continue;
      }
      const scope =
        rule.scope === 'team' ? 'team' : rule.scope === 'org' ? 'org' : 'user';
      const warningThresholdPercent =
        scope === 'user'
          ? limits.warningThresholdPercent
          : scope === 'org'
            ? limits.orgWarningThresholdPercent
            : undefined;
      standings.push({
        scope,
        ...(scope === 'team' && rule.scopeId !== undefined
          ? { teamId: rule.scopeId }
          : {}),
        period,
        periodKey: buildPeriodKeyFromTimestamp(period, now),
        resetsAt: buildPeriodEndFromTimestamp(period, now),
        ...(warningThresholdPercent !== undefined
          ? { warningThresholdPercent }
          : {}),
        ...(rule.maxTokens != null ? { maxTokens: rule.maxTokens } : {}),
        ...(rule.maxCostCents != null
          ? { maxCostCents: rule.maxCostCents }
          : {}),
        ...(rule.maxRequests != null ? { maxRequests: rule.maxRequests } : {}),
        usage,
      });
    }
  }
  return standings;
}

export type TurnAllowance =
  | { allowed: true; budgetCents: number }
  | { allowed: false; reason: string };

/**
 * The gateway allowance a managed turn may be minted with: the deployment's
 * per-turn default, capped by what remains under every cost rule that binds
 * the subject — after the spend already booked this period AND the
 * reservations of every turn still in flight (`reserved`), so concurrent
 * turns sizing themselves off the same balance cannot collectively overshoot
 * it. A token or request cap that is already reached refuses outright (a
 * turn is one ledger request). Refused when less than one cent remains.
 */
export async function resolveTurnAllowance(
  sql: Sql | TransactionSql,
  args: OrgBudgetSubject & {
    defaultCents: number;
    reserved: { orgCents: number; userCents: number };
  },
): Promise<TurnAllowance> {
  const config = await readGovernancePolicyForOrg(
    sql,
    args.organizationId,
    'budgets',
  );
  if (!config || !config.enabled || config.rules.length === 0) {
    return { allowed: true, budgetCents: args.defaultCents };
  }
  const applicableRules = collectAllApplicableRules(
    config.rules,
    args.userId,
    args.userTeamIds,
    args.userRole,
    undefined,
  );
  if (applicableRules.length === 0) {
    return { allowed: true, budgetCents: args.defaultCents };
  }

  let allowance = args.defaultCents;
  for (const period of new Set(applicableRules.map((rule) => rule.period))) {
    const periodRules = applicableRules.filter((r) => r.period === period);
    const limits = resolveEffectiveLimits(
      periodRules,
      args.userId,
      args.userTeamIds,
      args.userRole,
      undefined,
    );
    for (const bucket of await bucketsFor(
      sql,
      args,
      period,
      limits,
      args.reserved,
    )) {
      // One more cent and one more request: refused means nothing usable
      // remains under this rule — its own wording names the cap.
      const violation = checkRuleAgainstUsage(bucket.rule, bucket.usage, 1, 1);
      if (violation) {
        return {
          allowed: false,
          reason:
            violation.reason ??
            `The organization's ${period} spend cap has been reached.`,
        };
      }
      if (bucket.rule.maxCostCents != null) {
        allowance = Math.min(
          allowance,
          bucket.rule.maxCostCents - bucket.usage.costEstimate,
        );
      }
    }
  }
  const budgetCents = Math.floor(allowance);
  if (budgetCents < 1) {
    return {
      allowed: false,
      reason: 'The organization’s spend cap leaves no allowance for this turn.',
    };
  }
  return { allowed: true, budgetCents };
}
