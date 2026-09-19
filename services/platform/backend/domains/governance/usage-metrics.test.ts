// @vitest-environment node

/**
 * The usage metrics page's read folds ONE bounded page of the ledger. Above
 * the cap the page must be the same rows on every call — the newest window
 * — not whichever heap pages Postgres happened to hand back first.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { AUTOMATION_SUBJECT_ID } from '../../../lib/shared/constants/usage.ts';
import { buildPeriodKeyFromTimestamp } from '../../core/governance/helpers.ts';
import { getOrgUsageMetricsPg } from './usage-metrics.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(answer: (statement: Statement) => unknown[]): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = { text: strings.join('?'), values };
    statements.push(statement);
    return Promise.resolve(answer(statement));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the read exercises exactly the tag surface faked here
  return { sql: tag as unknown as Sql, statements };
}

function bucket(periodKey: string, index: number) {
  return {
    userId: `user_${index % 7}`,
    teamId: null,
    periodKey,
    requestCount: 1,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    costEstimate: 1,
    agentSlug: null,
    model: 'm',
    provider: 'p',
    connectorName: null,
    audioDurationSec: null,
    characterCount: null,
  };
}

describe('getOrgUsageMetricsPg', () => {
  it('walks the ledger newest-first under a deterministic order', async () => {
    const { sql, statements } = fakeSql((statement) =>
      statement.text.includes('FROM app.usage_ledger') ? [] : [],
    );

    await getOrgUsageMetricsPg(sql, 'org_1', {
      granularity: 'daily',
      periodDays: 7,
    });

    const scan = statements.find((s) =>
      s.text.includes('FROM app.usage_ledger'),
    );
    expect(scan).toBeDefined();
    const orderAt = scan?.text.indexOf('ORDER BY period_key DESC') ?? -1;
    const limitAt = scan?.text.indexOf('LIMIT') ?? -1;
    expect(orderAt).toBeGreaterThan(-1);
    expect(limitAt).toBeGreaterThan(orderAt);
  });

  it('reports the cap and folds only the capped page', async () => {
    const today = buildPeriodKeyFromTimestamp('daily', Date.now());
    const overflow = Array.from({ length: 20_001 }, (_, index) =>
      bucket(today, index),
    );
    const { sql } = fakeSql((statement) =>
      statement.text.includes('FROM app.usage_ledger') ? overflow : [],
    );

    const metrics = await getOrgUsageMetricsPg(sql, 'org_1', {
      granularity: 'daily',
      periodDays: 7,
    });

    expect(metrics.summary.capped).toBe(true);
    expect(metrics.summary.totalRequests).toBe(20_000);
  });

  it('names a project agent booked under its id and keeps the automation bucket out of the active users', async () => {
    const today = buildPeriodKeyFromTimestamp('daily', Date.now());
    const rows = [
      { ...bucket(today, 0), userId: 'user_1', agentSlug: 'agent-1' },
      {
        ...bucket(today, 1),
        userId: AUTOMATION_SUBJECT_ID,
        agentSlug: 'invoices/monthly',
      },
    ];
    const { sql } = fakeSql((statement) => {
      if (statement.text.includes('FROM app.usage_ledger')) return rows;
      if (statement.text.includes('FROM app.project_agents')) {
        return [{ id: 'agent-1', name: 'Alice' }];
      }
      return [];
    });

    const metrics = await getOrgUsageMetricsPg(sql, 'org_1', {
      granularity: 'daily',
      periodDays: 7,
    });

    // The sentinel's spend counts; the sentinel is not a person.
    expect(metrics.summary.totalRequests).toBe(2);
    expect(metrics.summary.activeUsers).toBe(1);
    expect(metrics.users.map((user) => user.userId).sort()).toEqual(
      [AUTOMATION_SUBJECT_ID, 'user_1'].sort(),
    );
    const byAgent = new Map(metrics.topAgents.map((a) => [a.agentSlug, a]));
    expect(byAgent.get('agent-1')).toMatchObject({ displayName: 'Alice' });
    expect(byAgent.get('invoices/monthly')).not.toHaveProperty('displayName');
  });
});
