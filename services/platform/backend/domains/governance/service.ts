import type { Sql, TransactionSql } from 'postgres';

import {
  evaluateFeatureFlags,
  type ResolvedFeatureFlags,
} from '../../../convex/governance/feature_enforcement.ts';
import { buildPeriodKeyFromTimestamp } from '../../../convex/governance/helpers.ts';
import {
  evaluateModelAccess,
  filterAccessibleModels,
  type ModelAccessCheckResult,
} from '../../../convex/governance/model_access_enforcement.ts';
import { findApplicableModelRule } from '../../../convex/governance/resolve_default_model.ts';
import {
  getUserTeamIds,
  findOrganizationMember,
} from '../../auth/membership.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';

/**
 * Governance enforcement over policy FILES — the 0.5 host for the REUSED
 * pure evaluators (`evaluateModelAccess`, `evaluateFeatureFlags`): the
 * configCache mirror died with the V8 runtime, so policies are read
 * straight from the org's governance config tree (the same reader every
 * other 0.5 policy consumer uses), and the verdicts are byte-identical to
 * 0.4's. Usage metering lands in `app.usage_ledger` — the same three
 * period buckets (daily/weekly/monthly) the 0.4 upsert maintained, one
 * atomic `ON CONFLICT` increment per bucket.
 */

async function whoIs(
  sql: Sql,
  organizationId: string,
  userId: string,
): Promise<{ userId: string; teamIds: string[]; role: string | undefined }> {
  const member = await findOrganizationMember(sql, organizationId, userId);
  const teamIds = await getUserTeamIds(sql, userId);
  return { userId, teamIds, role: member?.role };
}

/**
 * The Auto picker's one identity-explicit governance read — the 0.5 twin of
 * `governance/internal_queries.resolveModelGovernanceInternal`: the admin's
 * `default_models` pin (dropped when the org's `model_access` policy would
 * refuse it) plus the accessible subset of the catalog the picker offers.
 * The explicit-modelId path short-circuits to the single-model check.
 */
export async function resolveModelGovernanceForUser(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    supportedModels: string[];
    explicitModelId?: string;
  },
): Promise<{
  defaultModel?: { providerName: string; modelId: string };
  accessibleModelRefs: string[];
  explicitAllowed?: { allowed: boolean; reason?: string };
}> {
  if (args.explicitModelId !== undefined) {
    const verdict = await checkModelAccessForUser(sql, {
      organizationId: args.organizationId,
      userId: args.userId,
      modelId: args.explicitModelId,
    });
    return { accessibleModelRefs: [], explicitAllowed: verdict };
  }
  const who = await whoIs(sql, args.organizationId, args.userId);
  const accessConfig = await readGovernancePolicyForOrg(
    sql,
    args.organizationId,
    'model_access',
  );
  const whoFacts = {
    userId: who.userId,
    teamIds: who.teamIds,
    userRole: who.role,
  };

  let defaultModel: { providerName: string; modelId: string } | undefined;
  const defaults = await readGovernancePolicyForOrg(
    sql,
    args.organizationId,
    'default_models',
  );
  if (defaults?.enabled === true && defaults.rules.length > 0) {
    const rule = findApplicableModelRule(defaults.rules, who.teamIds, who.role);
    if (rule) {
      const pinAllowed = evaluateModelAccess(
        accessConfig,
        whoFacts,
        rule.modelId,
      );
      if (pinAllowed.allowed) {
        defaultModel = {
          providerName: rule.providerName,
          modelId: rule.modelId,
        };
      }
    }
  }

  const stripQualifier = (ref: string): string => {
    const slash = ref.indexOf('/');
    return slash === -1 ? ref : ref.slice(slash + 1);
  };
  const accessiblePlain = new Set(
    filterAccessibleModels(
      accessConfig,
      whoFacts,
      args.supportedModels.map(stripQualifier),
    ),
  );
  const accessibleModelRefs = args.supportedModels.filter((ref) =>
    accessiblePlain.has(stripQualifier(ref)),
  );
  return {
    ...(defaultModel !== undefined ? { defaultModel } : {}),
    accessibleModelRefs,
  };
}

/** The turn-boundary model-access verdict (the picker filter's server twin). */
export async function checkModelAccessForUser(
  sql: Sql,
  args: { organizationId: string; userId: string; modelId: string },
): Promise<ModelAccessCheckResult> {
  const config = await readGovernancePolicyForOrg(
    sql,
    args.organizationId,
    'model_access',
  );
  const who = await whoIs(sql, args.organizationId, args.userId);
  return evaluateModelAccess(
    config,
    { userId: who.userId, teamIds: who.teamIds, userRole: who.role },
    args.modelId,
  );
}

export async function resolveFeatureFlagsForUser(
  sql: Sql,
  args: { organizationId: string; userId: string },
): Promise<ResolvedFeatureFlags> {
  const config = await readGovernancePolicyForOrg(
    sql,
    args.organizationId,
    'feature_flags',
  );
  const who = await whoIs(sql, args.organizationId, args.userId);
  return evaluateFeatureFlags(config, who);
}

/** The turn lane's context cap. Null = no cap applies. */
export async function getContextCapForUser(
  sql: Sql,
  args: { organizationId: string; userId: string },
): Promise<number | null> {
  const flags = await resolveFeatureFlagsForUser(sql, args);
  return flags.maxContextTokens ?? null;
}

export interface UsageLedgerEntryInput {
  organizationId: string;
  userId: string;
  teamId?: string;
  inputTokens: number;
  outputTokens: number;
  costEstimateCents: number;
  timestamp: number;
  agentSlug?: string;
  model?: string;
  provider?: string;
  apiKeyId?: string;
  connectorName?: string;
  connectorOperation?: string;
  connectorCallCount?: number;
}

const ALL_PERIODS = ['daily', 'weekly', 'monthly'] as const;

/** One billable call → three period buckets, each an atomic upsert. */
export async function incrementUsageLedger(
  sql: Sql | TransactionSql,
  entry: UsageLedgerEntryInput,
): Promise<void> {
  const totalTokens = entry.inputTokens + entry.outputTokens;
  const now = Date.now();
  for (const period of ALL_PERIODS) {
    const periodKey = buildPeriodKeyFromTimestamp(period, entry.timestamp);
    await sql`
      INSERT INTO app.usage_ledger (
        org_id, user_id, team_id, period_key, granularity, agent_slug, model,
        provider, api_key_id, connector_name, connector_operation,
        input_tokens, output_tokens, total_tokens, cost_estimate_cents,
        request_count, connector_call_count, updated_at_ms
      ) VALUES (
        ${entry.organizationId}, ${entry.userId}, ${entry.teamId ?? null},
        ${periodKey}, ${period}, ${entry.agentSlug ?? null},
        ${entry.model ?? null}, ${entry.provider ?? null},
        ${entry.apiKeyId ?? null}, ${entry.connectorName ?? null},
        ${entry.connectorOperation ?? null},
        ${entry.inputTokens}, ${entry.outputTokens}, ${totalTokens},
        ${entry.costEstimateCents}, 1, ${entry.connectorCallCount ?? 0},
        ${now}
      )
      ON CONFLICT (
        org_id, user_id, period_key,
        coalesce(team_id, ''), coalesce(agent_slug, ''), coalesce(model, ''),
        coalesce(api_key_id, ''), coalesce(connector_name, ''),
        coalesce(connector_operation, '')
      ) DO UPDATE SET
        input_tokens = app.usage_ledger.input_tokens + EXCLUDED.input_tokens,
        output_tokens =
          app.usage_ledger.output_tokens + EXCLUDED.output_tokens,
        total_tokens = app.usage_ledger.total_tokens + EXCLUDED.total_tokens,
        cost_estimate_cents =
          app.usage_ledger.cost_estimate_cents
            + EXCLUDED.cost_estimate_cents,
        request_count = app.usage_ledger.request_count + 1,
        connector_call_count =
          app.usage_ledger.connector_call_count
            + EXCLUDED.connector_call_count,
        provider = coalesce(app.usage_ledger.provider, EXCLUDED.provider),
        updated_at_ms = ${now}
    `;
  }
}

/** Connector-lane accounting (the tool dispatch's metering seam). */
export async function recordConnectorUsage(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    userId: string;
    agentSlug?: string;
    connectorName: string;
    connectorOperation: string;
    costEstimateCents: number;
    timestamp: number;
  },
): Promise<void> {
  await incrementUsageLedger(sql, {
    organizationId: args.organizationId,
    userId: args.userId,
    inputTokens: 0,
    outputTokens: 0,
    costEstimateCents: args.costEstimateCents,
    timestamp: args.timestamp,
    ...(args.agentSlug !== undefined ? { agentSlug: args.agentSlug } : {}),
    connectorName: args.connectorName,
    connectorOperation: args.connectorOperation,
    connectorCallCount: 1,
  });
}

export interface UsageBucketRow {
  periodKey: string;
  granularity: string;
  model: string | null;
  agentSlug: string | null;
  totalTokens: number;
  costEstimateCents: number;
  requestCount: number;
}

export async function readUsageBuckets(
  sql: Sql,
  args: { organizationId: string; userId?: string; periodKey?: string },
): Promise<UsageBucketRow[]> {
  return sql<UsageBucketRow[]>`
    SELECT period_key AS "periodKey", granularity, model,
           agent_slug AS "agentSlug", total_tokens::float8 AS "totalTokens",
           cost_estimate_cents AS "costEstimateCents",
           request_count AS "requestCount"
    FROM app.usage_ledger
    WHERE org_id = ${args.organizationId}
      AND (${args.userId ?? null}::text IS NULL
           OR user_id = ${args.userId ?? null})
      AND (${args.periodKey ?? null}::text IS NULL
           OR period_key = ${args.periodKey ?? null})
    ORDER BY period_key DESC
  `;
}
