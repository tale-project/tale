/** Real PostgreSQL regression for #4440: cap display buckets, not daily rows. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { buildPeriodKeyFromTimestamp } from '../../core/governance/helpers.ts';
import { getOrgUsageMetricsPg } from './usage-metrics.ts';

const DAY = 24 * 60 * 60 * 1000;

export async function checkUsageMetricsBuckets(
  sql: Sql,
  ctx: { userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  // Private synthetic org: this lane cannot alter another lane's usage.
  const orgId = `itest-usage-${randomUUID()}`;
  const now = Date.now();
  const today = buildPeriodKeyFromTimestamp('daily', now);
  try {
    // 90 days × 250 API keys = 22,500 DAILY rows. API keys are deliberately
    // distinct on the ledger's unique key, but not a usage-page dimension.
    await sql`
      INSERT INTO app.usage_ledger (
        org_id, user_id, period_key, granularity, api_key_id, agent_slug,
        model, provider, input_tokens, output_tokens, total_tokens,
        cost_estimate_cents, request_count, updated_at_ms
      )
      SELECT ${orgId}, ${ctx.userId},
             (${today}::date - day)::text, 'daily', 'key-' || key,
             'usage-proof', 'usage-model', 'usage-provider', 10, 5, 15, 2, 1, ${now}
      FROM generate_series(0, 89) AS day
      CROSS JOIN generate_series(1, 250) AS key
    `;
    // Prior days can share a display week/month with the current window;
    // future days share today's display bucket. Neither belongs in totals.
    await sql`
      INSERT INTO app.usage_ledger (
        org_id, user_id, period_key, granularity, agent_slug, model, provider,
        cost_estimate_cents, request_count, updated_at_ms
      )
      SELECT ${orgId}, ${ctx.userId}, (${today}::date - day)::text,
             'daily', 'usage-proof', 'usage-model', 'usage-provider',
             CASE WHEN day BETWEEN 90 AND 179 THEN 7 ELSE 999 END,
             1, ${now}
      FROM generate_series(90, 180) AS day
      UNION ALL
      SELECT ${orgId}, ${ctx.userId}, (${today}::date + 1)::text,
             'daily', 'usage-proof', 'usage-model', 'usage-provider', 999, 1, ${now}
    `;
    const count = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.usage_ledger
      WHERE org_id = ${orgId} AND period_key BETWEEN
        (${today}::date - 89)::text AND ${today}
    `;
    record(
      'usage buckets: fixture exceeds 20,000 daily rows',
      count[0]?.count === 22_500,
      JSON.stringify(count),
    );

    const totals: number[] = [];
    for (const granularity of ['daily', 'weekly', 'monthly'] as const) {
      const metrics = await getOrgUsageMetricsPg(sql, orgId, {
        granularity,
        periodDays: 90,
      });
      const expected = new Map<string, number>();
      for (let day = 89; day >= 0; day--) {
        const key = buildPeriodKeyFromTimestamp(granularity, now - day * DAY);
        expected.set(key, (expected.get(key) ?? 0) + 250);
      }
      record(
        `usage buckets: ${granularity} complete 90-day totals without partial flag`,
        !metrics.summary.capped &&
          metrics.summary.totalRequests === 22_500 &&
          metrics.summary.totalInputTokens === 225_000 &&
          metrics.summary.totalOutputTokens === 112_500 &&
          metrics.summary.totalTokens === 337_500 &&
          metrics.summary.totalCostCents === 45_000 &&
          metrics.summary.activeUsers === 1,
        JSON.stringify(metrics.summary),
      );
      record(
        `usage buckets: ${granularity} UTC/ISO series and prior window stay isolated`,
        metrics.previousSummary.totalRequests === 90 &&
          metrics.previousSummary.totalCostCents === 630 &&
          metrics.previousSummary.activeUsers === 1 &&
          metrics.series.length === expected.size &&
          metrics.series.every(
            (point) =>
              point.requests === expected.get(point.periodKey) &&
              point.tokens === point.requests * 15 &&
              point.costCents === point.requests * 2,
          ),
        JSON.stringify({
          previous: metrics.previousSummary,
          series: metrics.series,
        }),
      );
      record(
        `usage buckets: ${granularity} preserves user, assistant and model breakdowns`,
        metrics.users.length === 1 &&
          metrics.users[0]?.userId === ctx.userId &&
          metrics.users[0]?.requests === 22_500 &&
          metrics.users[0]?.costCents === 45_000 &&
          metrics.topAgents.length === 1 &&
          metrics.topAgents[0]?.agentSlug === 'usage-proof' &&
          metrics.topAgents[0]?.requests === 22_500 &&
          metrics.topModels.length === 1 &&
          metrics.topModels[0]?.model === 'usage-model' &&
          metrics.topModels[0]?.provider === 'usage-provider' &&
          metrics.topModels[0]?.tokens === 337_500,
        JSON.stringify({
          users: metrics.users,
          agents: metrics.topAgents,
          models: metrics.topModels,
        }),
      );
      totals.push(metrics.summary.totalCostCents);
    }
    record(
      'usage buckets: all three granularities have equal complete totals',
      totals.every((total) => total === 45_000),
      JSON.stringify(totals),
    );
    const filtered = await getOrgUsageMetricsPg(sql, orgId, {
      granularity: 'monthly',
      periodDays: 90,
      model: 'other-model',
    });
    const foreign = await getOrgUsageMetricsPg(sql, `${orgId}-foreign`, {
      granularity: 'monthly',
      periodDays: 90,
    });
    record(
      'usage buckets: filters and tenant isolation survive SQL aggregation',
      filtered.summary.totalRequests === 0 &&
        !filtered.summary.capped &&
        foreign.summary.totalRequests === 0 &&
        foreign.previousSummary.totalRequests === 0 &&
        foreign.users.length === 0,
      JSON.stringify({ filtered: filtered.summary, foreign: foreign.summary }),
    );
    await sql`DELETE FROM app.usage_ledger WHERE org_id = ${orgId}`;
    // The same model/dimensions can hold LLM, transcription and TTS rows:
    // summing their discriminators together would relabel the LLM spend.
    await sql`
      INSERT INTO app.usage_ledger (
        org_id, user_id, period_key, granularity, api_key_id, model, provider,
        audio_duration_sec, character_count, request_count, updated_at_ms
      )
      SELECT ${orgId}, ${ctx.userId}, ${today}, 'daily', 'kind-' || kind,
             'mixed-model', 'mixed-provider',
             CASE WHEN kind = 2 THEN 10 ELSE 0 END,
             CASE WHEN kind = 3 THEN 100 ELSE 0 END, 1, ${now}
      FROM generate_series(1, 3) AS kind
    `;
    const mixed = await getOrgUsageMetricsPg(sql, orgId, {
      granularity: 'monthly',
      periodDays: 90,
    });
    record(
      'usage buckets: aggregation preserves positive audio/character classification',
      mixed.summary.totalRequests === 3 &&
        mixed.topModels[0]?.requests === 1 &&
        mixed.topVoiceModels[0]?.requests === 1 &&
        mixed.topVoiceModels[0]?.characters === 100 &&
        mixed.topAgents.length === 3,
      JSON.stringify({
        models: mixed.topModels,
        voice: mixed.topVoiceModels,
        agents: mixed.topAgents,
      }),
    );
    await sql`DELETE FROM app.usage_ledger WHERE org_id = ${orgId}`;
    // Distinct users remain distinct display buckets: the partial-result
    // contract still applies once GROUPED rows, not raw rows, exceed 20k.
    await sql`
      INSERT INTO app.usage_ledger (
        org_id, user_id, period_key, granularity, request_count, updated_at_ms
      )
      SELECT ${orgId}, 'bucket-user-' || subject, ${today}, 'daily', 1, ${now}
      FROM generate_series(1, 20001) AS subject
    `;
    const capped = await getOrgUsageMetricsPg(sql, orgId, {
      granularity: 'monthly',
      periodDays: 90,
    });
    record(
      'usage buckets: more than 20,000 grouped rows still report partial totals',
      capped.summary.capped && capped.summary.totalRequests === 20_000,
      JSON.stringify(capped.summary),
    );
  } finally {
    await sql`DELETE FROM app.usage_ledger WHERE org_id = ${orgId}`;
  }
}
