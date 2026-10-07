import type { Sql } from 'postgres';

import {
  foldOrgUsageMetrics,
  scanStartKeyFor,
  type GetOrgUsageMetricsArgs,
  type OrgUsageMetrics,
  type UsageLedgerFoldRow,
} from '../../core/governance/get_org_usage_metrics.ts';
import { buildPeriodKeyFromTimestamp } from '../../core/governance/helpers.ts';

/**
 * The usage metrics page's read — the 0.4 fold REUSED over one bounded SQL
 * page of `app.usage_ledger` aggregated into display buckets in SQL.
 */
const MAX_SCAN = 20_000;

export async function getOrgUsageMetricsPg(
  sql: Sql,
  organizationId: string,
  args: Omit<GetOrgUsageMetricsArgs, 'organizationId'>,
): Promise<OrgUsageMetrics> {
  const now = Date.now();
  const scanStart = scanStartKeyFor(args, now);
  const currentStart = buildPeriodKeyFromTimestamp(
    'daily',
    now - (args.periodDays - 1) * 24 * 60 * 60 * 1000,
  );
  const today = buildPeriodKeyFromTimestamp('daily', now);
  const rows = await sql<UsageLedgerFoldRow[]>`
    SELECT user_id AS "userId", team_id AS "teamId",
           max(period_key) AS "periodKey", sum(request_count)::float8 AS "requestCount",
           sum(input_tokens)::float8 AS "inputTokens",
           sum(output_tokens)::float8 AS "outputTokens",
           sum(total_tokens)::float8 AS "totalTokens",
           sum(cost_estimate_cents) AS "costEstimate",
           agent_slug AS "agentSlug", model, provider,
           connector_name AS "connectorName",
           sum(audio_duration_sec) AS "audioDurationSec",
           sum(character_count)::float8 AS "characterCount"
    FROM app.usage_ledger
    WHERE org_id = ${organizationId}
      AND granularity = ${'daily'}
      AND period_key >= ${scanStart}
      AND period_key <= ${today}
    GROUP BY
      CASE ${args.granularity}
        WHEN 'weekly' THEN to_char(period_key::date, 'IYYY-"W"IW')
        WHEN 'monthly' THEN substring(period_key, 1, 7)
        ELSE period_key
      END,
      (period_key >= ${currentStart}),
      user_id, team_id, agent_slug, model, provider, connector_name,
      coalesce(audio_duration_sec > 0, false),
      coalesce(character_count > 0, false)
    ORDER BY max(period_key) DESC, user_id, team_id, agent_slug, model,
             provider, connector_name,
             coalesce(audio_duration_sec > 0, false),
             coalesce(character_count > 0, false)
    LIMIT ${MAX_SCAN + 1}
  `;
  // Split reporting windows BEFORE grouping: a partial ISO week or month
  // must not pull prior-window spend into the current cards. max(period_key)
  // is a daily key in that window and chart bucket, so the existing fold
  // assigns it correctly. The cap now counts grouped rows, not raw days or
  // API keys/connector operations the page never distinguishes. Keep the
  // >0 discriminators separate so aggregation cannot change a row's kind.
  // A total order also makes tied display buckets deterministic under the cap.
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
    async (agentSlugs) => {
      if (agentSlugs.length === 0) return new Map();
      // Project agents book under their id (`governance/README.md`); the
      // Top assistants table shows the agent's name. Slugs that are no
      // project agent (a chat assistant, an automation, a sentinel) stay.
      const agents = await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM app.project_agents
        WHERE org_id = ${organizationId} AND id = ANY(${agentSlugs})
      `;
      return new Map(agents.map((agent) => [agent.id, agent.name] as const));
    },
  );
}
