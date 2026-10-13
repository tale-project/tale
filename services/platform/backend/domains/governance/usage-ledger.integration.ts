import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { buildPeriodKeyFromTimestamp } from '../../core/governance/helpers.ts';
import { incrementUsageLedger } from './service.ts';
import { getOrgUsageMetricsPg } from './usage-metrics.ts';

export async function verifyProviderUsageLedger(sql: Sql): Promise<void> {
  const organizationId = `usage-provider-proof-${randomUUID()}`;
  const timestamp = Date.now();
  const entry = {
    organizationId,
    userId: '__automation__',
    inputTokens: 10,
    outputTokens: 5,
    timestamp,
  };
  try {
    await incrementUsageLedger(sql, {
      ...entry,
      model: 'shared-model',
      provider: 'provider-a',
      costEstimateCents: 10,
    });
    await incrementUsageLedger(sql, {
      ...entry,
      model: 'shared-model',
      provider: 'provider-b',
      costEstimateCents: 90,
    });
    for (const granularity of ['daily', 'weekly', 'monthly'] as const) {
      const args = { granularity, periodDays: 7 as const };
      const metrics = await getOrgUsageMetricsPg(sql, organizationId, args);
      assert.equal(metrics.summary.totalCostCents, 100);
      assert.equal(metrics.summary.totalRequests, 2);
      assert.equal(metrics.topModels.length, 2);
      for (const [provider, cents] of [
        ['provider-a', 10],
        ['provider-b', 90],
      ] as const) {
        const filtered = await getOrgUsageMetricsPg(sql, organizationId, {
          ...args,
          provider,
          model: 'shared-model',
        });
        assert.equal(filtered.summary.totalRequests, 1);
        assert.equal(filtered.summary.totalCostCents, cents);
        assert.equal(filtered.topModels[0]?.provider, provider);
      }
    }
    await incrementUsageLedger(sql, {
      ...entry,
      model: 'shared-model',
      provider: 'provider-a',
      costEstimateCents: 5,
    });
    await incrementUsageLedger(sql, {
      ...entry,
      model: 'distinct-model',
      provider: 'provider-b',
      costEstimateCents: 20,
    });
    for (const provider of [undefined, 'provider-a']) {
      await incrementUsageLedger(sql, {
        ...entry,
        model: 'unknown-provider-model',
        provider,
        costEstimateCents: 3,
      });
    }
    const metrics = await getOrgUsageMetricsPg(sql, organizationId, {
      granularity: 'daily',
      periodDays: 7,
    });
    assert.equal(metrics.summary.totalRequests, 6);
    assert.equal(metrics.summary.totalCostCents, 131);
    const repeated = metrics.topModels.find(
      (row) => row.provider === 'provider-a' && row.model === 'shared-model',
    );
    assert.equal(repeated?.requests, 2);
    assert.equal(repeated?.costCents, 15);
    assert.equal(
      metrics.topModels.find((row) => row.model === 'distinct-model')
        ?.costCents,
      20,
    );
    const aggregate = await sql<{ cents: number; requests: number }[]>`
      SELECT sum(cost_estimate_cents)::float8 AS cents,
             sum(request_count)::int AS requests
      FROM app.usage_ledger
      WHERE org_id = ${organizationId} AND granularity = 'daily'
    `;
    assert.equal(aggregate[0]?.cents, 131);
    assert.equal(aggregate[0]?.requests, 6);
    for (let booking = 0; booking < 2; booking++) {
      await sql`
        INSERT INTO app.usage_ledger (
          org_id, user_id, period_key, granularity, model, provider,
          request_count, cost_estimate_cents, updated_at_ms
        ) VALUES (
          ${organizationId}, ${entry.userId},
          ${buildPeriodKeyFromTimestamp('daily', timestamp)}, 'daily',
          'shared-model', 'provider-a', 1, 2, ${timestamp}
        )
        ON CONFLICT (
          org_id, user_id, period_key,
          coalesce(team_id, ''), coalesce(agent_slug, ''), coalesce(model, ''),
          coalesce(api_key_id, ''), coalesce(connector_name, ''),
          coalesce(connector_operation, '')
        ) DO UPDATE SET
          request_count = app.usage_ledger.request_count + 1,
          cost_estimate_cents = app.usage_ledger.cost_estimate_cents
            + EXCLUDED.cost_estimate_cents
      `;
    }
    const rolling = await getOrgUsageMetricsPg(sql, organizationId, {
      granularity: 'daily',
      periodDays: 7,
      provider: 'provider-a',
      model: 'shared-model',
    });
    assert.equal(rolling.summary.totalRequests, 4);
    assert.equal(rolling.summary.totalCostCents, 19);
    assert.equal(rolling.topModels.length, 1);
  } finally {
    await sql`DELETE FROM app.usage_ledger WHERE org_id = ${organizationId}`;
    const remaining = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.usage_ledger
      WHERE org_id = ${organizationId}
    `;
    assert.equal(remaining[0]?.count, 0);
  }
}
