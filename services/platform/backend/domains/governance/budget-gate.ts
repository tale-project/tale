import type { BudgetRule } from '@tale/shared/schemas/governance';
import type { Sql, TransactionSql } from 'postgres';

import {
  findOrganizationMember,
  getUserTeamIds,
} from '../../auth/membership.ts';
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
 * that spends on the org's behalf: chat turns (app and REST), the
 * TTS/transcription reservations, video-link ingest, the budget-status
 * banner, the member's usage page, and the managed harness turns (project
 * agents, automation agent nodes).
 *
 * The buckets one subject is measured in: their personal caps against their
 * own usage, each of their teams' shared caps against that team's CURRENT
 * members' usage, the organization's caps against everyone's, and — only
 * for a request an API key authenticated — the key's caps against the
 * key's own usage.
 */

export interface UsageTotals {
  totalTokens: number;
  costEstimate: number;
  requestCount: number;
}

const NO_USAGE: UsageTotals = {
  totalTokens: 0,
  costEstimate: 0,
  requestCount: 0,
};

/** Whose booked usage a bucket sums. */
export type UsageScope =
  | { kind: 'user'; userId: string }
  | { kind: 'team'; teamId: string }
  | { kind: 'apiKey'; apiKeyId: string }
  | { kind: 'org' };

/**
 * One scope's booked usage for a period. A team's usage is read through
 * membership — the usage of the people in the team now — not through the
 * ledger's `team_id`: most lanes (chat, tools, agent turns) book no team,
 * and a member of two teams counts toward both team caps without the
 * organization's total counting them twice.
 */
export async function periodUsage(
  sql: Sql | TransactionSql,
  organizationId: string,
  periodKey: string,
  scope: UsageScope,
): Promise<UsageTotals> {
  let rows: UsageTotals[];
  switch (scope.kind) {
    case 'user':
      rows = await sql<UsageTotals[]>`
        SELECT coalesce(sum(total_tokens), 0)::float8 AS "totalTokens",
               coalesce(sum(cost_estimate_cents), 0)::float8 AS "costEstimate",
               coalesce(sum(request_count), 0)::float8 AS "requestCount"
        FROM app.usage_ledger
        WHERE org_id = ${organizationId} AND period_key = ${periodKey}
          AND user_id = ${scope.userId}
      `;
      break;
    case 'team':
      rows = await sql<UsageTotals[]>`
        SELECT coalesce(sum(total_tokens), 0)::float8 AS "totalTokens",
               coalesce(sum(cost_estimate_cents), 0)::float8 AS "costEstimate",
               coalesce(sum(request_count), 0)::float8 AS "requestCount"
        FROM app.usage_ledger
        WHERE org_id = ${organizationId} AND period_key = ${periodKey}
          AND user_id IN (
            SELECT tm."userId" FROM "teamMember" tm
            JOIN "team" t ON t."id" = tm."teamId"
            WHERE tm."teamId" = ${scope.teamId}
              AND t."organizationId" = ${organizationId}
          )
      `;
      break;
    case 'apiKey':
      rows = await sql<UsageTotals[]>`
        SELECT coalesce(sum(total_tokens), 0)::float8 AS "totalTokens",
               coalesce(sum(cost_estimate_cents), 0)::float8 AS "costEstimate",
               coalesce(sum(request_count), 0)::float8 AS "requestCount"
        FROM app.usage_ledger
        WHERE org_id = ${organizationId} AND period_key = ${periodKey}
          AND api_key_id = ${scope.apiKeyId}
      `;
      break;
    case 'org':
      rows = await sql<UsageTotals[]>`
        SELECT coalesce(sum(total_tokens), 0)::float8 AS "totalTokens",
               coalesce(sum(cost_estimate_cents), 0)::float8 AS "costEstimate",
               coalesce(sum(request_count), 0)::float8 AS "requestCount"
        FROM app.usage_ledger
        WHERE org_id = ${organizationId} AND period_key = ${periodKey}
      `;
      break;
  }
  return rows[0] ?? NO_USAGE;
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
  /** The API key that authenticated the request. Only a keyed request is
   * measured against `apiKey`-scoped caps. */
  apiKeyId?: string;
}

/**
 * The subject as the member is NOW — their teams in this organization and
 * their role — so every lane that asks is measured in the same buckets: a
 * team joined or a role changed binds the next request, whichever lane it
 * takes.
 */
export async function loadBudgetSubject(
  sql: Sql | TransactionSql,
  args: { organizationId: string; userId: string; apiKeyId?: string },
): Promise<OrgBudgetSubject> {
  const [member, userTeamIds] = await Promise.all([
    findOrganizationMember(sql, args.organizationId, args.userId),
    getUserTeamIds(sql, args.organizationId, args.userId),
  ]);
  return {
    organizationId: args.organizationId,
    userId: args.userId,
    userTeamIds,
    ...(member !== null ? { userRole: member.role } : {}),
    ...(args.apiKeyId !== undefined ? { apiKeyId: args.apiKeyId } : {}),
  };
}

/** Whether the organization's budget policy is on with at least one rule —
 * when it is not, no cap binds anyone and an admission has nothing to
 * serialize. */
export async function budgetPolicyActive(
  sql: Sql | TransactionSql,
  organizationId: string,
): Promise<boolean> {
  const config = await readGovernancePolicyForOrg(
    sql,
    organizationId,
    'budgets',
  );
  return config !== null && config.enabled && config.rules.length > 0;
}

/** Spend that work still in flight has claimed but not booked yet. */
export interface ReservedSpend {
  costCents: number;
  tokens: number;
  requests: number;
}

/** In-flight reservations per bucket, added to the booked usage so
 * concurrent work sizing itself off the same balance cannot collectively
 * overshoot a cap. */
export interface BudgetReservations {
  user?: ReservedSpend;
  org?: ReservedSpend;
  apiKey?: ReservedSpend;
  teams?: Readonly<Record<string, ReservedSpend>>;
}

export type BudgetScope = 'user' | 'team' | 'org' | 'apiKey';

/** The buckets one evaluation walks, in the order the ladder binds: the
 * caller's personal triple, each of their teams' shared caps, the org's,
 * then the authenticating key's. */
interface BudgetBucket {
  scope: BudgetScope;
  teamId?: string;
  rule: BudgetRule;
  usage: UsageTotals;
}

function withReserved(
  usage: UsageTotals,
  reserved: ReservedSpend | undefined,
): UsageTotals {
  if (reserved === undefined) return usage;
  return {
    totalTokens: usage.totalTokens + reserved.tokens,
    costEstimate: usage.costEstimate + reserved.costCents,
    requestCount: usage.requestCount + reserved.requests,
  };
}

async function bucketsFor(
  sql: Sql | TransactionSql,
  subject: OrgBudgetSubject,
  period: BudgetRule['period'],
  limits: Limits,
  reservations: BudgetReservations,
  now: number,
): Promise<BudgetBucket[]> {
  const periodKey = buildPeriodKeyFromTimestamp(period, now);
  const org = subject.organizationId;
  const buckets: BudgetBucket[] = [];
  buckets.push({
    scope: 'user',
    rule: { scope: 'default', period, ...limitsTriple(limits) },
    usage: withReserved(
      await periodUsage(sql, org, periodKey, {
        kind: 'user',
        userId: subject.userId,
      }),
      reservations.user,
    ),
  });
  // Each team's SHARED cap against that team's aggregate — the team rule's
  // own values, never the personal triple (see `EffectiveLimits.teamLimits`).
  for (const teamLimit of limits.teamLimits) {
    if (!teamLimitsHasCap(teamLimit)) continue;
    buckets.push({
      scope: 'team',
      teamId: teamLimit.teamId,
      rule: {
        scope: 'team',
        scopeId: teamLimit.teamId,
        period,
        maxTokens: teamLimit.maxTokens,
        maxCostCents: teamLimit.maxCostCents,
        maxRequests: teamLimit.maxRequests,
      },
      usage: withReserved(
        await periodUsage(sql, org, periodKey, {
          kind: 'team',
          teamId: teamLimit.teamId,
        }),
        reservations.teams?.[teamLimit.teamId],
      ),
    });
  }
  if (
    limits.orgMaxTokens != null ||
    limits.orgMaxCostCents != null ||
    limits.orgMaxRequests != null
  ) {
    buckets.push({
      scope: 'org',
      rule: {
        scope: 'org',
        period,
        maxTokens: limits.orgMaxTokens,
        maxCostCents: limits.orgMaxCostCents,
        maxRequests: limits.orgMaxRequests,
      },
      usage: withReserved(
        await periodUsage(sql, org, periodKey, { kind: 'org' }),
        reservations.org,
      ),
    });
  }
  if (
    subject.apiKeyId !== undefined &&
    (limits.apiKeyMaxTokens != null ||
      limits.apiKeyMaxCostCents != null ||
      limits.apiKeyMaxRequests != null)
  ) {
    buckets.push({
      scope: 'apiKey',
      rule: {
        scope: 'apiKey',
        apiKeyId: subject.apiKeyId,
        period,
        maxTokens: limits.apiKeyMaxTokens,
        maxCostCents: limits.apiKeyMaxCostCents,
        maxRequests: limits.apiKeyMaxRequests,
      },
      usage: withReserved(
        await periodUsage(sql, org, periodKey, {
          kind: 'apiKey',
          apiKeyId: subject.apiKeyId,
        }),
        reservations.apiKey,
      ),
    });
  }
  return buckets;
}

const PERIODS: readonly BudgetRule['period'][] = ['daily', 'weekly', 'monthly'];

/** The rules that bind the subject, grouped by period (shortest first). */
async function applicableLimitsByPeriod(
  sql: Sql | TransactionSql,
  subject: OrgBudgetSubject,
): Promise<{ period: BudgetRule['period']; limits: Limits }[]> {
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
    subject.apiKeyId,
  );
  return PERIODS.flatMap((period) => {
    const periodRules = applicableRules.filter((r) => r.period === period);
    if (periodRules.length === 0) return [];
    return [
      {
        period,
        limits: resolveEffectiveLimits(
          periodRules,
          subject.userId,
          subject.userTeamIds,
          subject.userRole,
          subject.apiKeyId,
        ),
      },
    ];
  });
}

/** A cap the subject's next request would breach, named precisely enough to
 * explain it: whose bucket, which limit, and when its period resets. */
export interface BudgetViolation {
  scope: BudgetScope;
  /** The team whose shared cap binds — team scope only. */
  teamId?: string;
  code: 'TOKEN_LIMIT' | 'COST_LIMIT' | 'REQUEST_LIMIT';
  period: BudgetRule['period'];
  used: number;
  limit: number;
  reason: string;
  /** When the binding period rolls over (epoch ms). */
  resetsAt: number;
}

/**
 * The first cap the subject is at or over, after the booked usage, any
 * in-flight `reservations`, and a `prospective` spend of their own — `null`
 * when every cap that binds still has room (or no budget policy binds).
 */
export async function findBudgetViolation(
  sql: Sql | TransactionSql,
  subject: OrgBudgetSubject,
  options: {
    prospectiveCostCents?: number;
    prospectiveRequests?: number;
    reservations?: BudgetReservations;
    now?: number;
  } = {},
): Promise<BudgetViolation | null> {
  const now = options.now ?? Date.now();
  for (const { period, limits } of await applicableLimitsByPeriod(
    sql,
    subject,
  )) {
    for (const bucket of await bucketsFor(
      sql,
      subject,
      period,
      limits,
      options.reservations ?? {},
      now,
    )) {
      const breach = checkRuleAgainstUsage(
        bucket.rule,
        bucket.usage,
        options.prospectiveCostCents ?? 0,
        options.prospectiveRequests ?? 0,
      );
      if (
        breach?.code === undefined ||
        breach.used === undefined ||
        breach.limit === undefined
      ) {
        continue;
      }
      return {
        scope: bucket.scope,
        ...(bucket.teamId !== undefined ? { teamId: bucket.teamId } : {}),
        code: breach.code,
        period,
        used: breach.used,
        limit: breach.limit,
        reason: breach.reason ?? `The ${period} usage limit has been reached.`,
        resetsAt: buildPeriodEndFromTimestamp(period, now),
      };
    }
  }
  return null;
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
  const violation = await findBudgetViolation(sql, args, {
    prospectiveCostCents: args.prospectiveCostCents,
    prospectiveRequests: args.prospectiveRequests,
  });
  if (violation === null) return { allowed: true };
  return {
    allowed: false,
    code: violation.code,
    period: violation.period,
    used: violation.used,
    limit: violation.limit,
    reason: violation.reason,
  };
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

/**
 * Every cap that binds the subject, with what has been used against it this
 * period — the same buckets `checkOrgBudget` walks, read without a
 * prospective spend, so a reader sees exactly the numbers that would refuse
 * their next request. Only buckets that carry a cap are returned; `[]` when
 * no budget policy binds. A session reader carries no API key, so key caps
 * never appear here.
 */
export async function readBudgetStanding(
  sql: Sql | TransactionSql,
  subject: OrgBudgetSubject,
  now: number = Date.now(),
): Promise<BudgetStanding[]> {
  const standings: BudgetStanding[] = [];
  for (const { period, limits } of await applicableLimitsByPeriod(
    sql,
    subject,
  )) {
    const buckets = await bucketsFor(sql, subject, period, limits, {}, now);
    for (const { scope, teamId, rule, usage } of buckets) {
      if (scope === 'apiKey') continue;
      if (
        rule.maxTokens == null &&
        rule.maxCostCents == null &&
        rule.maxRequests == null
      ) {
        continue;
      }
      const warningThresholdPercent =
        scope === 'user'
          ? limits.warningThresholdPercent
          : scope === 'org'
            ? limits.orgWarningThresholdPercent
            : undefined;
      standings.push({
        scope,
        ...(teamId !== undefined ? { teamId } : {}),
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
 * holds of every other turn still in flight (`reservations`), so concurrent
 * turns sizing themselves off the same balance cannot collectively overshoot
 * it. A token or request cap that is already reached refuses outright (a
 * turn is one ledger request). Refused when less than one cent remains.
 */
export async function resolveTurnAllowance(
  sql: Sql | TransactionSql,
  args: OrgBudgetSubject & {
    defaultCents: number;
    /** What every other turn in flight holds, per bucket — chat turns and
     * managed turns alike (`readInFlightReservations`). */
    reservations: BudgetReservations;
  },
): Promise<TurnAllowance> {
  const { reservations } = args;
  const now = Date.now();
  let allowance = args.defaultCents;
  for (const { period, limits } of await applicableLimitsByPeriod(sql, args)) {
    for (const bucket of await bucketsFor(
      sql,
      args,
      period,
      limits,
      reservations,
      now,
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
