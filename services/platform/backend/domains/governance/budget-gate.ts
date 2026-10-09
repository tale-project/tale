import {
  allBudgetRules,
  type BudgetRule,
} from '@tale/shared/schemas/governance';
import type { Sql, TransactionSql } from 'postgres';

import { usageLedgerSubjectForms } from '../../../lib/shared/constants/usage.ts';
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
import { readKeyIdentity } from '../api_keys/owners.ts';

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
  | {
      kind: 'apiKey';
      apiKeyId: string;
      /** The key's own identity, when it is not a person: everything it
       * spends is the key's, whether or not the booking named the key. */
      identity?: string;
    }
  | { kind: 'project'; projectId: string }
  | { kind: 'org' };

/**
 * One scope's booked usage for a period. A team's usage is read through
 * membership — the usage of the people in the team now — not through the
 * ledger's `team_id`: most lanes (chat, tools, agent turns) book no team,
 * and a member of two teams counts toward both team caps without the
 * organization's total counting them twice.
 *
 * A person's spend is matched under every form the ledger ever booked it
 * as — the bare id and the legacy door forms (`user:<id>`, `api-key:<id>`)
 * the workflow lane wrote before it derived the person from the run's
 * starter — so a cap sees the member's whole spend, whichever door it came
 * through (`governance/README.md`).
 */
/**
 * What a bucket used this period. Its requests are model requests: a
 * connector call is counted on `connector_call_count` and never as a
 * request, so a ledger row a connector names is skipped — rows booked before
 * connector calls stopped carrying a request included. A project's buckets
 * (`app.project_usage`) never take a connector call at all.
 */
async function periodUsage(
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
               coalesce(sum(request_count) FILTER (WHERE connector_name IS NULL), 0)::float8
                 AS "requestCount"
        FROM app.usage_ledger
        WHERE org_id = ${organizationId} AND period_key = ${periodKey}
          AND user_id = ANY(${usageLedgerSubjectForms(scope.userId)})
      `;
      break;
    case 'team':
      // The team's current members, and every key the team owns — a
      // revoked one's spend this period still counts: it was the team's.
      rows = await sql<UsageTotals[]>`
        SELECT coalesce(sum(total_tokens), 0)::float8 AS "totalTokens",
               coalesce(sum(cost_estimate_cents), 0)::float8 AS "costEstimate",
               coalesce(sum(request_count) FILTER (WHERE connector_name IS NULL), 0)::float8
                 AS "requestCount"
        FROM app.usage_ledger
        WHERE org_id = ${organizationId} AND period_key = ${periodKey}
          AND regexp_replace(user_id, '^(user|api-key):', '') IN (
            SELECT tm."userId" FROM "teamMember" tm
            JOIN "team" t ON t."id" = tm."teamId"
            WHERE tm."teamId" = ${scope.teamId}
              AND t."organizationId" = ${organizationId}
            UNION ALL
            SELECT o.principal_user_id FROM app.api_key_owners o
            WHERE o.team_id = ${scope.teamId}
              AND o.org_id = ${organizationId}
              AND o.owner_kind = 'team'
          )
      `;
      break;
    case 'apiKey':
      rows = await sql<UsageTotals[]>`
        SELECT coalesce(sum(total_tokens), 0)::float8 AS "totalTokens",
               coalesce(sum(cost_estimate_cents), 0)::float8 AS "costEstimate",
               coalesce(sum(request_count) FILTER (WHERE connector_name IS NULL), 0)::float8
                 AS "requestCount"
        FROM app.usage_ledger
        WHERE org_id = ${organizationId} AND period_key = ${periodKey}
          AND (api_key_id = ${scope.apiKeyId}
               OR user_id = ANY(${
                 scope.identity === undefined
                   ? []
                   : usageLedgerSubjectForms(scope.identity)
               }))
      `;
      break;
    case 'project':
      // Everything booked as the project's — its own buckets, written beside
      // the ledger (`incrementUsageLedger`).
      rows = await sql<UsageTotals[]>`
        SELECT coalesce(sum(total_tokens), 0)::float8 AS "totalTokens",
               coalesce(sum(cost_estimate_cents), 0)::float8 AS "costEstimate",
               coalesce(sum(request_count), 0)::float8 AS "requestCount"
        FROM app.project_usage
        WHERE org_id = ${organizationId} AND project_id = ${scope.projectId}
          AND period_key = ${periodKey}
      `;
      break;
    case 'org':
      rows = await sql<UsageTotals[]>`
        SELECT coalesce(sum(total_tokens), 0)::float8 AS "totalTokens",
               coalesce(sum(cost_estimate_cents), 0)::float8 AS "costEstimate",
               coalesce(sum(request_count) FILTER (WHERE connector_name IS NULL), 0)::float8
                 AS "requestCount"
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
  /** A subject that is nobody: a managed turn of a run a trigger started
   * (booked under `__automation__`), an op without a run to attribute, or
   * an API key that is not a person (`loadBudgetSubject`). No personal or
   * role cap binds it — there is no person to bind — only the
   * organization's, the key's when a key was involved, and the shared cap
   * of the team in `userTeamIds` (a team's own key). */
  impersonal?: boolean;
  /** For an API key that is not a person, its identity (`userId`): all
   * its spend is the key's — a run its REST comment started books under
   * the identity without naming the key — so the key's caps count it. */
  apiKeyIdentity?: string;
  /** The projects the work belongs to — a chat's thread's, an agent run's,
   * an automation run's (every project its automation is bound to, when the
   * run names none), a project's own API key's. Each one's `project` caps
   * bind the work, whoever asked for it, as each of a member's teams' caps
   * bind them. */
  projectIds?: readonly string[];
}

/**
 * The subject as the member is NOW — their teams in this organization and
 * their role — so every lane that asks is measured in the same buckets: a
 * team joined or a role changed binds the next request, whichever lane it
 * takes.
 *
 * An API key that is not a person — a team's, a project's or the
 * organization's own (`domains/api_keys/owners.ts`) — is no member: no
 * personal, role or default cap binds it. Its own key caps and the
 * organization's do, and a team's key is measured against its team's shared
 * caps, its spend counting toward the team.
 */
export async function loadBudgetSubject(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    userId: string;
    apiKeyId?: string;
    /** The projects the work belongs to, when the lane knows them. */
    projectIds?: readonly string[];
  },
): Promise<OrgBudgetSubject> {
  const [member, userTeamIds] = await Promise.all([
    findOrganizationMember(sql, args.organizationId, args.userId),
    getUserTeamIds(sql, args.organizationId, args.userId),
  ]);
  // A person has a member row; only a subject without one can be a key —
  // read live or revoked: work the key started before it was revoked still
  // spends as the key, never as a person.
  const principal =
    member === null ? await readKeyIdentity(sql, args.userId) : null;
  if (principal !== null) {
    return {
      organizationId: args.organizationId,
      userId: args.userId,
      userTeamIds:
        principal.kind === 'team' &&
        principal.teamId !== null &&
        principal.organizationId === args.organizationId
          ? [principal.teamId]
          : [],
      impersonal: true,
      apiKeyId: args.apiKeyId ?? principal.apiKeyId,
      apiKeyIdentity: args.userId,
      // A project's own key spends in its project, whatever it calls.
      ...(principal.kind === 'project' && principal.projectId !== null
        ? { projectIds: [principal.projectId] }
        : inProjects(args.projectIds)),
    };
  }
  return {
    organizationId: args.organizationId,
    userId: args.userId,
    userTeamIds,
    ...(member !== null ? { userRole: member.role } : {}),
    ...(args.apiKeyId !== undefined ? { apiKeyId: args.apiKeyId } : {}),
    ...inProjects(args.projectIds),
  };
}

/** The `projectIds` of a subject in these projects; nothing for none. */
function inProjects(projectIds: readonly string[] | undefined): {
  projectIds?: readonly string[];
} {
  return projectIds !== undefined && projectIds.length > 0
    ? { projectIds: [...new Set(projectIds)] }
    : {};
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
  return config !== null && config.enabled && allBudgetRules(config).length > 0;
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
  /** What the work in flight in each of the subject's projects holds. */
  projects?: Readonly<Record<string, ReservedSpend>>;
}

export type BudgetScope = 'user' | 'team' | 'org' | 'apiKey' | 'project';

/** The buckets one evaluation walks, in the order the ladder binds: the
 * caller's personal triple, each of their teams' shared caps, each of the
 * work's projects', the org's, then the authenticating key's. */
interface BudgetBucket {
  scope: BudgetScope;
  teamId?: string;
  projectId?: string;
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
  // The personal triple binds a person; an impersonal subject has none
  // (and no team either, but for a team's own API key, whose spend is its
  // team's).
  if (subject.impersonal !== true) {
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
  }
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
  // Each project's cap against everything spent in that project.
  for (const projectLimit of limits.projectLimits) {
    if (
      projectLimit.maxTokens == null &&
      projectLimit.maxCostCents == null &&
      projectLimit.maxRequests == null
    ) {
      continue;
    }
    buckets.push({
      scope: 'project',
      projectId: projectLimit.projectId,
      rule: {
        scope: 'project',
        scopeId: projectLimit.projectId,
        period,
        maxTokens: projectLimit.maxTokens,
        maxCostCents: projectLimit.maxCostCents,
        maxRequests: projectLimit.maxRequests,
      },
      usage: withReserved(
        await periodUsage(sql, org, periodKey, {
          kind: 'project',
          projectId: projectLimit.projectId,
        }),
        reservations.projects?.[projectLimit.projectId],
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
          ...(subject.apiKeyIdentity !== undefined
            ? { identity: subject.apiKeyIdentity }
            : {}),
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
  const rules = config?.enabled === true ? allBudgetRules(config) : [];
  if (rules.length === 0) return [];
  const applicableRules = collectAllApplicableRules(
    rules,
    subject.userId,
    subject.userTeamIds,
    subject.userRole,
    subject.apiKeyId,
    subject.projectIds,
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
          subject.projectIds,
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
  /** The project whose cap binds — project scope only. */
  projectId?: string;
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
        ...(bucket.projectId !== undefined
          ? { projectId: bucket.projectId }
          : {}),
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
   * for this bucket sets one (a team's shared cap warns at its own rule's
   * threshold). */
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
      // A reader's standing is their own: an API key's caps and a
      // project's bind the work, not the person reading.
      if (scope === 'apiKey' || scope === 'project') continue;
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
            : limits.teamLimits.find((team) => team.teamId === teamId)
                ?.warningThresholdPercent;
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
  | {
      allowed: false;
      reason: string;
      /** The cap that refused — whose bucket, which limit, and when its
       * period resets — for a door that answers the refusal as the chat
       * lane's coded `BUDGET_EXCEEDED` (the model endpoints). */
      violation?: BudgetViolation;
      /** For a whole-hold admission refused because its worst case does not
       * fit: what the tightest caps still leave — the cents under the cost
       * caps and the tokens under the token caps (absent where no such cap
       * binds) — so the door can name what WOULD fit. */
      room?: { cents?: number; tokens?: number };
      /** Refused because too many of the subject's (or its API key's)
       * requests are already running — not a budget cap at all. */
      concurrency?: {
        scope: 'user' | 'apiKey';
        running: number;
        limit: number;
      };
    };

/** Whose bucket a cap is, as a refusal names it — at the start of a
 * sentence, and inside one. */
const BUCKET_OWNER: Record<BudgetScope, string> = {
  user: 'Your',
  team: "Your team's",
  org: 'The organization’s',
  apiKey: "This API key's",
  project: "This project's",
};
const BUCKET_OWNER_INLINE: Record<BudgetScope, string> = {
  user: 'your own',
  team: "your team's",
  org: 'the organization’s',
  apiKey: "this API key's",
  project: "this project's",
};

/** The bucket with the least room left under one kind of cap. */
interface TightestBucket {
  bucket: BudgetBucket;
  period: BudgetRule['period'];
  room: number;
}

function violationOf(
  tightest: TightestBucket,
  code: 'COST_LIMIT' | 'TOKEN_LIMIT',
  reason: string,
  now: number,
): BudgetViolation {
  const { bucket, period } = tightest;
  const limit =
    code === 'COST_LIMIT'
      ? (bucket.rule.maxCostCents ?? 0)
      : (bucket.rule.maxTokens ?? 0);
  return {
    scope: bucket.scope,
    ...(bucket.teamId !== undefined ? { teamId: bucket.teamId } : {}),
    ...(bucket.projectId !== undefined ? { projectId: bucket.projectId } : {}),
    code,
    period,
    used:
      code === 'COST_LIMIT'
        ? bucket.usage.costEstimate
        : bucket.usage.totalTokens,
    limit,
    reason,
    resetsAt: buildPeriodEndFromTimestamp(period, now),
  };
}

/**
 * The gateway allowance a managed turn may be minted with: the deployment's
 * per-turn default, capped by what remains under every cost rule that binds
 * the subject — after the spend already booked this period AND the
 * holds of every other turn still in flight (`reservations`), so concurrent
 * turns sizing themselves off the same balance cannot collectively overshoot
 * it. A token or request cap that is already reached refuses outright (a
 * turn is one ledger request). Refused when less than one cent remains.
 *
 * `whole` admits the default as a whole or not at all: a request whose hold
 * IS its worst case (a model-endpoint call — the prompt plus its output cap
 * at the catalog price, and those tokens) is refused when that worst case
 * does not fit under every cap, instead of being minted a smaller allowance
 * it could spend past. The refusal names the tightest cap and carries what
 * room is left.
 */
export async function resolveTurnAllowance(
  sql: Sql | TransactionSql,
  args: OrgBudgetSubject & {
    defaultCents: number;
    /** What every other turn in flight holds, per bucket — chat turns and
     * managed turns alike (`readInFlightReservations`). */
    reservations: BudgetReservations;
    whole?: { prospectiveTokens: number };
  },
): Promise<TurnAllowance> {
  const { reservations } = args;
  const now = Date.now();
  let allowance = args.defaultCents;
  /** The cost bucket with the least room left — the cap to name when what
   * remains does not cover the turn. */
  let tightestCost: TightestBucket | undefined;
  /** The token bucket with the least room left — whole admissions only. */
  let tightestTokens: TightestBucket | undefined;
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
      // remains under this rule — its own wording names the cap. A whole
      // admission asks only whether the cap is already reached: its own
      // cost and tokens are measured whole below, and its request is the
      // one a request cap still has room for.
      const violation =
        args.whole !== undefined
          ? checkRuleAgainstUsage(bucket.rule, bucket.usage, 0, 0)
          : checkRuleAgainstUsage(bucket.rule, bucket.usage, 1, 1);
      if (violation?.code !== undefined) {
        // The rule's own wording, and whose cap it is: a key's cap and the
        // organization's read alike otherwise.
        const reason =
          violation.reason !== undefined
            ? `${violation.reason}, under ${BUCKET_OWNER_INLINE[bucket.scope]} cap`
            : `${BUCKET_OWNER[bucket.scope]} ${period} spend cap has been reached.`;
        return {
          allowed: false,
          reason,
          violation: {
            scope: bucket.scope,
            ...(bucket.teamId !== undefined ? { teamId: bucket.teamId } : {}),
            ...(bucket.projectId !== undefined
              ? { projectId: bucket.projectId }
              : {}),
            code: violation.code,
            period,
            used: violation.used ?? 0,
            limit: violation.limit ?? 0,
            reason,
            resetsAt: buildPeriodEndFromTimestamp(period, now),
          },
        };
      }
      if (bucket.rule.maxCostCents != null) {
        const room = bucket.rule.maxCostCents - bucket.usage.costEstimate;
        if (tightestCost === undefined || room < tightestCost.room) {
          tightestCost = { bucket, period, room };
        }
        if (room < allowance) allowance = room;
      }
      if (args.whole !== undefined && bucket.rule.maxTokens != null) {
        const room = bucket.rule.maxTokens - bucket.usage.totalTokens;
        if (tightestTokens === undefined || room < tightestTokens.room) {
          tightestTokens = { bucket, period, room };
        }
      }
    }
  }
  const room = {
    ...(tightestCost !== undefined
      ? { cents: Math.max(0, tightestCost.room) }
      : {}),
    ...(tightestTokens !== undefined
      ? { tokens: Math.max(0, Math.floor(tightestTokens.room)) }
      : {}),
  };
  if (args.whole !== undefined) {
    if (
      tightestTokens !== undefined &&
      tightestTokens.room < args.whole.prospectiveTokens
    ) {
      const reason = `${BUCKET_OWNER[tightestTokens.bucket.scope]} ${tightestTokens.period} token cap leaves too few tokens for this request.`;
      return {
        allowed: false,
        reason,
        violation: violationOf(tightestTokens, 'TOKEN_LIMIT', reason, now),
        room,
      };
    }
    if (tightestCost !== undefined && tightestCost.room < args.defaultCents) {
      const reason = `${BUCKET_OWNER[tightestCost.bucket.scope]} ${tightestCost.period} spend cap leaves too little for this request.`;
      return {
        allowed: false,
        reason,
        violation: violationOf(tightestCost, 'COST_LIMIT', reason, now),
        room,
      };
    }
    return { allowed: true, budgetCents: Math.floor(args.defaultCents) };
  }
  const budgetCents = Math.floor(allowance);
  if (budgetCents < 1) {
    const reason =
      tightestCost !== undefined
        ? `${BUCKET_OWNER[tightestCost.bucket.scope]} ${tightestCost.period} spend cap leaves no allowance for this turn.`
        : 'The spend caps leave no allowance for this turn.';
    return {
      allowed: false,
      reason,
      ...(tightestCost !== undefined
        ? { violation: violationOf(tightestCost, 'COST_LIMIT', reason, now) }
        : {}),
    };
  }
  return { allowed: true, budgetCents };
}
