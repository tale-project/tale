// @vitest-environment node

/**
 * Unit lock for the trigger read the MCP tools answer (`list_triggers`,
 * `get_automation`): the pg store's `listTriggers` selects the failure
 * streak (0124) beside the fire ledger and carries it onto the
 * `TriggerView` — the count always, the last failure's `lastFailedAt`,
 * `lastFailureCode` and `lastFailedRunId` only when there was one. The
 * store's own `listTriggers` runs here for real against a scripted `sql`,
 * so the select list is under test too, not a mock of it; the real-Postgres
 * probe (`trigger-pause.integration.ts`) reads a paused schedule back
 * through the same function.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { pgAutomationStore } from './dispatch-store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** A `listTriggers` row as the select aliases it. */
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'trg_1',
  name: 'ops/nightly',
  kind: 'schedule',
  cron: '0 6 * * *',
  timezone: 'UTC',
  event: null,
  hasToken: false,
  enabled: true,
  lastFiredAt: 4_000,
  lastRunId: 'run_4',
  lastSkippedAt: null,
  lastSkipReason: null,
  consecutiveFailures: 0,
  lastFailedAt: null,
  lastFailureCode: null,
  lastFailedRunId: null,
  ...overrides,
});

function store(rows: Record<string, unknown>[]): {
  engine: ReturnType<typeof pgAutomationStore>;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ');
    statements.push({ text, values });
    return text.includes('FROM app.automation_triggers') ? rows : [];
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
  });
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a scripted tagged template standing in for postgres.js
    engine: pgAutomationStore(sql as unknown as Sql, {
      organizationId: 'org_1',
      actor: 'api-key:user_1',
    }),
    statements,
  };
}

describe('the MCP trigger view carries the failure streak', () => {
  it('selects the streak columns under the names the view reads', async () => {
    const { engine, statements } = store([row()]);
    await engine.listTriggers?.('ops/nightly');
    const select = statements.find((s) =>
      s.text.includes('FROM app.automation_triggers'),
    );
    for (const column of [
      'consecutive_failures AS "consecutiveFailures"',
      'last_failed_at_ms::float8 AS "lastFailedAt"',
      'last_failure_code AS "lastFailureCode"',
      'last_failed_run_id AS "lastFailedRunId"',
      'last_skip_reason AS "lastSkipReason"',
    ]) {
      expect(select?.text).toContain(column);
    }
    expect(select?.values).toContain('org_1');
  });

  it('answers a schedule its failures paused with the streak and the last failure', async () => {
    const { engine } = store([
      row({
        enabled: false,
        lastSkippedAt: 9_000,
        lastSkipReason: 'paused_after_failures',
        consecutiveFailures: 5,
        lastFailedAt: 9_000,
        lastFailureCode: 'node_error',
        lastFailedRunId: 'run_9',
      }),
    ]);
    await expect(engine.listTriggers?.('ops/nightly')).resolves.toEqual([
      {
        id: 'trg_1',
        name: 'ops/nightly',
        kind: 'schedule',
        cron: '0 6 * * *',
        timezone: 'UTC',
        hasToken: false,
        enabled: false,
        lastFiredAt: 4_000,
        lastRunId: 'run_4',
        lastSkippedAt: 9_000,
        lastSkipReason: 'paused_after_failures',
        consecutiveFailures: 5,
        lastFailedAt: 9_000,
        lastFailureCode: 'node_error',
        lastFailedRunId: 'run_9',
      },
    ]);
  });

  it('carries the count always and leaves out a last failure there never was', async () => {
    const { engine } = store([row()]);
    const [view] = (await engine.listTriggers?.('ops/nightly')) ?? [];
    expect(view?.consecutiveFailures).toBe(0);
    expect(view).not.toHaveProperty('lastFailedAt');
    expect(view).not.toHaveProperty('lastFailureCode');
    expect(view).not.toHaveProperty('lastFailedRunId');
    expect(view).not.toHaveProperty('lastSkipReason');
  });
});

describe('the validator reads what the enabled trigger sends', () => {
  it('samples the enabled trigger, its fixed input under the trigger fields', async () => {
    const { engine, statements } = store([
      row({ input: { owner: 'tale', repo: 'tale' } }),
    ]);
    const sample = await engine.triggerInput?.('ops/nightly');
    expect(sample).toMatchObject({
      kind: 'schedule',
      input: {
        owner: 'tale',
        repo: 'tale',
        trigger: 'schedule',
        firedAt: expect.any(Number),
      },
      ignorePointers: [],
      fixedInput: { owner: 'tale', repo: 'tale' },
    });
    const select = statements.find((s) =>
      s.text.includes('FROM app.automation_triggers'),
    );
    expect(select?.values).toContain('org_1');
    expect(select?.values).toContain('ops/nightly');
  });

  it('sets a webhook’s unknown body aside, and says nothing of a trigger that is off', async () => {
    const webhook = store([row({ kind: 'webhook', cron: null })]);
    expect(await webhook.engine.triggerInput?.('ops/nightly')).toMatchObject({
      kind: 'webhook',
      ignorePointers: ['/payload'],
    });
    const off = store([row({ enabled: false })]);
    expect(await off.engine.triggerInput?.('ops/nightly')).toBeNull();
    const none = store([]);
    expect(await none.engine.triggerInput?.('ops/nightly')).toBeNull();
  });
});
