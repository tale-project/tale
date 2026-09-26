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

  it('folds the legacy door forms onto the person and a trigger form onto the automation bucket', async () => {
    const today = buildPeriodKeyFromTimestamp('daily', Date.now());
    // Rows the workflow lane booked before it derived the subject from the
    // run's starter: the same member behind three `user_id` spellings, and
    // a trigger-started run under its trigger id.
    const rows = [
      { ...bucket(today, 0), userId: 'user_1', costEstimate: 100 },
      { ...bucket(today, 1), userId: 'user:user_1', costEstimate: 10 },
      { ...bucket(today, 2), userId: 'api-key:user_1', costEstimate: 1 },
      { ...bucket(today, 3), userId: 'trigger:trig_1', costEstimate: 5 },
    ];
    const { sql, statements } = fakeSql((statement) => {
      if (statement.text.includes('FROM app.usage_ledger')) return rows;
      if (statement.text.includes('FROM "user"')) {
        return [{ id: 'user_1', name: 'Larry' }];
      }
      return [];
    });

    const metrics = await getOrgUsageMetricsPg(sql, 'org_1', {
      granularity: 'daily',
      periodDays: 7,
    });

    // One person, one row, the whole spend; the trigger's spend is the
    // automation bucket's; neither door form is an "active user".
    expect(metrics.summary.activeUsers).toBe(1);
    expect(metrics.users).toHaveLength(2);
    const byUser = new Map(metrics.users.map((u) => [u.userId, u]));
    expect(byUser.get('user_1')).toMatchObject({
      displayName: 'Larry',
      requests: 3,
      costCents: 111,
    });
    expect(byUser.get(AUTOMATION_SUBJECT_ID)).toMatchObject({
      requests: 1,
      costCents: 5,
    });
    // The name lookup asks for the bare id, never for a door form.
    const lookup = statements.find((s) => s.text.includes('FROM "user"'));
    const askedIds = lookup?.values[0];
    expect(askedIds).toContain('user_1');
    expect(askedIds).not.toContain('user:user_1');
    expect(askedIds).not.toContain('api-key:user_1');
  });

  it('keeps a multi-request LLM bucket stamped with zero seconds and characters in Top models', async () => {
    const today = buildPeriodKeyFromTimestamp('daily', Date.now());
    // The upsert used to turn NULL into 0 on a bucket's second request, so
    // nearly every chat bucket carries `0` audio seconds and `0`
    // characters. Zero audio is not a transcription; zero characters is not
    // speech — the row is an LLM row and counts under its model.
    const rows = [
      {
        ...bucket(today, 0),
        requestCount: 2,
        totalTokens: 30,
        costEstimate: 20,
        audioDurationSec: 0,
        characterCount: 0,
      },
      {
        ...bucket(today, 1),
        userId: 'user_2',
        agentSlug: '__tts__',
        model: 'voice-1',
        requestCount: 2,
        costEstimate: 4,
        audioDurationSec: 0,
        characterCount: 500,
      },
      {
        ...bucket(today, 2),
        userId: 'user_3',
        requestCount: 2,
        costEstimate: 3,
        audioDurationSec: 90,
        characterCount: 0,
      },
    ];
    const { sql } = fakeSql((statement) =>
      statement.text.includes('FROM app.usage_ledger') ? rows : [],
    );

    const metrics = await getOrgUsageMetricsPg(sql, 'org_1', {
      granularity: 'daily',
      periodDays: 7,
    });

    expect(metrics.topModels).toEqual([
      expect.objectContaining({ model: 'm', requests: 2, costCents: 20 }),
    ]);
    expect(metrics.topVoiceModels).toEqual([
      expect.objectContaining({
        model: 'voice-1',
        requests: 2,
        characters: 500,
      }),
    ]);
    // The transcription row (real seconds) stays out of both tables.
    expect(metrics.summary.totalRequests).toBe(6);
  });
});
