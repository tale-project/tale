// @vitest-environment node

/**
 * The runs a trigger started, as the trigger panel lists them under a
 * webhook's recent deliveries: newest first, each with the lane the webhook
 * door recognised its delivery by while the ledger row lives. The store's
 * own `listTriggerRuns` runs here against a scripted `sql`, so the select
 * is under test too; the real-Postgres lane
 * (`checkAutomationTriggerDelivery` in `integration-check.ts`) reads real
 * deliveries back and checks the plan.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { listTriggerRuns, TRIGGER_RUNS_MAX } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function scripted(rows: Record<string, unknown>[]): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replaceAll(/\s+/g, ' '),
      values,
    });
    return rows;
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a scripted tagged template standing in for postgres.js
  return { sql: tag as unknown as Sql, statements };
}

describe('listTriggerRuns', () => {
  it('names the delivery lane of each webhook run: Ada sees which header GitHub sent', async () => {
    const { sql } = scripted([
      {
        runId: 'run_3',
        startedAt: 3_000,
        status: 'running',
        source: 'header:x-github-delivery',
      },
      { runId: 'run_2', startedAt: 2_000, status: 'success', source: 'body' },
      // The ledger row is gone: the delivery's identity expired.
      { runId: 'run_1', startedAt: 1_000, status: 'failed', source: null },
    ]);
    expect(
      await listTriggerRuns(sql, 'org_1', { name: 'billing/github-sync' }),
    ).toEqual([
      {
        runId: 'run_3',
        startedAt: 3_000,
        status: 'running',
        deliverySource: 'header',
        header: 'x-github-delivery',
      },
      {
        runId: 'run_2',
        startedAt: 2_000,
        status: 'success',
        deliverySource: 'body',
        header: null,
      },
      {
        runId: 'run_1',
        startedAt: 1_000,
        status: 'failed',
        deliverySource: null,
        header: null,
      },
    ]);
  });

  it('reads only the runs the bound trigger started, newest first, and ten by default', async () => {
    const { sql, statements } = scripted([]);
    await listTriggerRuns(sql, 'org_1', { name: 'ops/nightly' });
    const [select] = statements;
    expect(select?.text).toContain("r.started_by = 'trigger:' || t.id");
    expect(select?.text).toContain('ORDER BY r.started_at_ms DESC, r.id DESC');
    expect(select?.text).toContain('d.expires_at_ms >= s.started_at_ms');
    expect(select?.values).toEqual(
      expect.arrayContaining(['org_1', 'ops/nightly', 10]),
    );
  });

  it('holds the limit between 1 and the cap', async () => {
    const { sql, statements } = scripted([]);
    await listTriggerRuns(sql, 'org_1', { name: 'ops/nightly', limit: 500 });
    await listTriggerRuns(sql, 'org_1', { name: 'ops/nightly', limit: 0 });
    expect(statements[0]?.values).toContain(TRIGGER_RUNS_MAX);
    expect(statements[1]?.values).toContain(1);
  });

  it('leaves out a run in a project the reader cannot see', async () => {
    const { sql, statements } = scripted([]);
    await listTriggerRuns(sql, 'org_1', {
      name: 'ops/nightly',
      visibleProjectIds: ['proj_billing'],
    });
    expect(statements[0]?.text).toContain('r.project_id IS NULL');
    expect(statements[0]?.values).toEqual(
      expect.arrayContaining([false, ['proj_billing']]),
    );
  });
});
