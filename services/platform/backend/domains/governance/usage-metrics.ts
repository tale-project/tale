import type { Sql } from 'postgres';

import {
  foldOrgUsageMetrics,
  scanStartKeyFor,
  type GetOrgUsageMetricsArgs,
  type OrgUsageMetrics,
  type UsageLedgerFoldRow,
} from '../../core/governance/get_org_usage_metrics.ts';

/**
 * The usage metrics page's read — the 0.4 fold REUSED over one bounded SQL
 * page of `app.usage_ledger` (same scan window, same 20k cap, same buckets).
 */
const MAX_SCAN = 20_000;

export async function getOrgUsageMetricsPg(
  sql: Sql,
  organizationId: string,
  args: Omit<GetOrgUsageMetricsArgs, 'organizationId'>,
): Promise<OrgUsageMetrics> {
  const now = Date.now();
  const scanStart = scanStartKeyFor(args, now);
  const rows = await sql<UsageLedgerFoldRow[]>`
    SELECT user_id AS "userId", team_id AS "teamId",
           period_key AS "periodKey", request_count AS "requestCount",
           input_tokens::float8 AS "inputTokens",
           output_tokens::float8 AS "outputTokens",
           total_tokens::float8 AS "totalTokens",
           cost_estimate_cents AS "costEstimate",
           agent_slug AS "agentSlug", model, provider,
           connector_name AS "connectorName",
           audio_duration_sec AS "audioDurationSec",
           character_count::float8 AS "characterCount"
    FROM app.usage_ledger
    WHERE org_id = ${organizationId}
      AND granularity = ${args.granularity}
      AND period_key >= ${scanStart}
    LIMIT ${MAX_SCAN + 1}
  `;
  const capped = rows.length > MAX_SCAN;
  // pg answers NULL where the 0.4 doc had absent — normalize for the fold.
  const walk = rows.slice(0, MAX_SCAN).map((row) => {
    const out: UsageLedgerFoldRow = {
      userId: row.userId,
      periodKey: row.periodKey,
      requestCount: row.requestCount,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      costEstimate: row.costEstimate,
    };
    if (row.teamId != null) out.teamId = row.teamId;
    if (row.agentSlug != null) out.agentSlug = row.agentSlug;
    if (row.model != null) out.model = row.model;
    if (row.provider != null) out.provider = row.provider;
    if (row.connectorName != null) out.connectorName = row.connectorName;
    if (row.audioDurationSec != null) {
      out.audioDurationSec = row.audioDurationSec;
    }
    if (row.characterCount != null) out.characterCount = row.characterCount;
    return out;
  });
  return foldOrgUsageMetrics(
    walk,
    capped,
    { ...args, organizationId },
    now,
    async (userIds) => {
      if (userIds.length === 0) return new Map();
      const users = await sql<{ id: string; name: string | null }[]>`
        SELECT "id", "name" FROM "user" WHERE "id" = ANY(${userIds})
      `;
      const map = new Map<string, string>();
      for (const user of users) {
        if (user.name !== null) map.set(user.id, user.name);
      }
      return map;
    },
  );
}
