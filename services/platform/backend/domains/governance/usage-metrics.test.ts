// @vitest-environment node

/**
 * The usage metrics page's read folds ONE bounded page of the ledger. Above
 * the cap the page must be the same rows on every call — the newest window
 * — not whichever heap pages Postgres happened to hand back first.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => vi.restoreAllMocks());

  it('counts a connector call as no request, a row booked before that rule included [GOV-R15]', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-08T12:00:00Z'));
    const today = '2026-10-08';
    const modelRow = Object.assign(bucket(today, 1), {
      agentSlug: 'assistant',
    });
    // A search the assistant ran: booked with a request before connector
    // calls stopped carrying one.
    const toolRow = Object.assign(bucket(today, 2), {
      agentSlug: 'assistant',
      connectorName: 'chat-tools',
      model: null,
      provider: null,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costEstimate: 0,
    });
    const { sql } = fakeSql((statement) =>
      statement.text.includes('FROM app.usage_ledger')
        ? [modelRow, toolRow]
        : [],
    );

    const metrics = await getOrgUsageMetricsPg(sql, 'org_1', {
      granularity: 'daily',
      periodDays: 7,
    });

    expect(metrics.summary.totalRequests).toBe(1);
    // Calling a connector alone makes nobody an active user.
    expect(metrics.summary.activeUsers).toBe(1);
    expect(metrics.topAgents).toEqual([
      expect.objectContaining({ agentSlug: 'assistant', requests: 1 }),
    ]);
    expect(metrics.series.reduce((sum, point) => sum + point.requests, 0)).toBe(
      1,
    );
  });

  it('keeps seven-day totals and prior spend isolated across chart granularities', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-28T12:00:00Z'));
    // All three granularities exist on write. The September monthly bucket
    // contains spend outside both seven-day reporting windows.
    const bookings = [
      ['2026-09-05', 300],
      ['2026-09-16', 20],
      ['2026-09-28', 10],
      ['2026-09-29', 500],
    ] as const;
    const ledger = bookings.flatMap(([date, costEstimate]) =>
      (['daily', 'weekly', 'monthly'] as const).map((granularity) =>
        Object.assign(
          bucket(buildPeriodKeyFromTimestamp(granularity, Date.parse(date)), 0),
          { orgId: 'org_1', granularity, costEstimate },
        ),
      ),
    );
    const { sql, statements } = fakeSql((statement) => {
      if (!statement.text.includes('FROM app.usage_ledger')) return [];
      const [orgId, granularity, scanStart] = statement.values;
      return ledger.filter(
        (row) =>
          row.orgId === orgId &&
          row.granularity === granularity &&
          typeof scanStart === 'string' &&
          row.periodKey >= scanStart,
      );
    });
    const results = [];
    for (const granularity of ['daily', 'weekly', 'monthly'] as const) {
      const metrics = await getOrgUsageMetricsPg(sql, 'org_1', {
        granularity,
        periodDays: 7,
      });
      expect(metrics.summary).toEqual({
        totalRequests: 1,
        totalInputTokens: 10,
        totalOutputTokens: 5,
        totalTokens: 15,
        totalCostCents: 10,
        activeUsers: 1,
        capped: false,
      });
      expect(metrics.previousSummary).toEqual({
        totalRequests: 1,
        totalTokens: 15,
        totalCostCents: 20,
        activeUsers: 1,
      });
      expect(metrics.users).toHaveLength(1);
      expect(metrics.users[0]).toMatchObject({ requests: 1, costCents: 10 });
      expect(metrics.topAgents[0]).toMatchObject({
        requests: 1,
        costCents: 10,
      });
      expect(metrics.topModels[0]).toMatchObject({
        requests: 1,
        costCents: 10,
      });
      expect(
        metrics.series.reduce((sum, point) => sum + point.costCents, 0),
      ).toBe(10);
      results.push(metrics);
    }
    expect(results[0]?.series).toHaveLength(7);
    expect(results[2]?.series).toEqual([
      {
        periodKey: '2026-09',
        requests: 1,
        inputTokens: 10,
        outputTokens: 5,
        tokens: 15,
        costCents: 10,
      },
    ]);
    for (const statement of statements.filter((s) =>
      s.text.includes('FROM app.usage_ledger'),
    )) {
      expect(statement.values.slice(0, 3)).toEqual([
        'org_1',
        'daily',
        '2026-09-15',
      ]);
    }
    const foreign = await getOrgUsageMetricsPg(sql, 'foreign_org', {
      granularity: 'monthly',
      periodDays: 7,
    });
    expect(foreign.summary.totalRequests).toBe(0);
    expect(foreign.summary.totalCostCents).toBe(0);
    expect(foreign.previousSummary.totalCostCents).toBe(0);
    expect(foreign.users).toEqual([]);
  });

  it('assigns boundary days before grouping a partial month or ISO week', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2027-01-04T12:00:00Z'));
    const rows = [
      { ...bucket('2026-12-21', 0), costEstimate: 1000 }, // outside
      { ...bucket('2026-12-22', 0), costEstimate: 1 }, // prior start
      { ...bucket('2026-12-28', 0), costEstimate: 2 }, // prior end
      { ...bucket('2026-12-29', 0), costEstimate: 4 }, // current start
      { ...bucket('2027-01-04', 0), costEstimate: 8 }, // current end
      { ...bucket('2027-01-05', 0), costEstimate: 1000 }, // future
    ];
    const { sql } = fakeSql((s) =>
      s.text.includes('FROM app.usage_ledger') ? rows : [],
    );
    for (const granularity of ['daily', 'weekly', 'monthly'] as const) {
      const metrics = await getOrgUsageMetricsPg(sql, 'org_1', {
        granularity,
        periodDays: 7,
      });
      expect(metrics.summary.totalCostCents).toBe(12);
      expect(metrics.previousSummary.totalCostCents).toBe(3);
      expect(
        metrics.series.filter((p) => p.requests > 0).map((p) => p.costCents),
      ).toEqual([4, 8]);
    }
  });

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
    const orderAt = scan?.text.indexOf('ORDER BY max(period_key) DESC') ?? -1;
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

  it('books a key that is not a person as its own row, and never as an active user [APIKEY-R9]', async () => {
    const today = buildPeriodKeyFromTimestamp('daily', Date.now());
    const rows = [
      { ...bucket(today, 0), userId: 'user_1' },
      { ...bucket(today, 1), userId: 'key_identity' },
    ];
    const { sql, statements } = fakeSql((statement) => {
      if (statement.text.includes('FROM app.usage_ledger')) return rows;
      if (statement.text.includes('FROM app.api_key_owners o')) {
        return [
          {
            userId: 'key_identity',
            kind: 'team',
            teamName: 'Finance',
            projectName: null,
          },
        ];
      }
      return [];
    });

    const metrics = await getOrgUsageMetricsPg(sql, 'org_1', {
      granularity: 'daily',
      periodDays: 7,
    });

    // Its spend counts; the key is no person.
    expect(metrics.summary.totalRequests).toBe(2);
    expect(metrics.summary.activeUsers).toBe(1);
    const byUser = new Map(metrics.users.map((user) => [user.userId, user]));
    expect(byUser.get('key_identity')?.apiKey).toEqual({
      kind: 'team',
      teamName: 'Finance',
      projectName: null,
    });
    expect(byUser.get('user_1')).not.toHaveProperty('apiKey');
    // Only this organization's keys answer for its subjects.
    const read = statements.find((statement) =>
      statement.text.includes('FROM app.api_key_owners o'),
    );
    expect(read?.values[0]).toBe('org_1');
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
