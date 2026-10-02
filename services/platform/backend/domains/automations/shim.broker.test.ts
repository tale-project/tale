// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { automationShimHandlers } from './shim.ts';

function fakeSql(execId = 'exec-current') {
  const writes: unknown[] = [];
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (strings.join('?').includes('SELECT status, checkpoints')) {
      return [
        {
          status: 'running',
          checkpoints: {
            cursor: {
              node: 'agent',
              agent: {
                execId,
                agentSessionId: 'conversation',
                brokerTokenHash: 'old-account',
              },
            },
          },
        },
      ];
    }
    writes.push(values[0]);
    return [];
  };
  sql.json = (value: unknown) => value;
  sql.begin = async (callback: (tx: typeof sql) => unknown) => callback(sql);
  return { sql: sql as unknown as Sql, writes };
}

describe('automation-agent broker account attribution', () => {
  it.each([null, 'new-account'])(
    'replaces a prior broker account with %s for the current launch',
    async (brokerTokenHash) => {
      const db = fakeSql();
      const stamp = automationShimHandlers(db.sql)[
        'automations/mutations:stampAgentTurnLaunch'
      ];
      expect(
        await stamp?.({
          organizationId: 'org-1',
          runId: 'run-1',
          nodeId: 'agent',
          execId: 'exec-current',
          launchedAt: 123,
          brokerTokenHash,
        }),
      ).toEqual({ stamped: true });
      expect(db.writes).toEqual([
        {
          nodes: {},
          executions: 0,
          cursor: {
            node: 'agent',
            agent: {
              execId: 'exec-current',
              agentSessionId: 'conversation',
              launchedAt: 123,
              ...(brokerTokenHash !== null ? { brokerTokenHash } : {}),
            },
          },
        },
      ]);
    },
  );

  it('never clears another exec’s selected account', async () => {
    const db = fakeSql('exec-other');
    const stamp = automationShimHandlers(db.sql)[
      'automations/mutations:stampAgentTurnLaunch'
    ];
    expect(
      await stamp?.({
        organizationId: 'org-1',
        runId: 'run-1',
        nodeId: 'agent',
        execId: 'exec-current',
        launchedAt: 123,
        brokerTokenHash: null,
      }),
    ).toEqual({ stamped: false });
    expect(db.writes).toEqual([]);
  });
});

describe('a start that waited for sandbox room launching', () => {
  it('turns the run’s room park into an agent park, and says so', async () => {
    const statements: { text: string; values: unknown[] }[] = [];
    const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replaceAll(/\s+/g, ' ');
      statements.push({ text, values });
      if (text.includes('SELECT status, checkpoints, detail')) {
        return [
          {
            status: 'waiting',
            detail: 'room:agent',
            checkpoints: {
              cursor: { node: 'agent', agent: { execId: 'exec-current' } },
            },
          },
        ];
      }
      return [];
    };
    sql.json = (value: unknown) => value;
    sql.begin = async (callback: (tx: typeof sql) => unknown) => callback(sql);

    const stamp = automationShimHandlers(sql as unknown as Sql)[
      'automations/mutations:stampAgentTurnLaunch'
    ];
    expect(
      await stamp?.({
        organizationId: 'org-1',
        runId: 'run-1',
        nodeId: 'agent',
        execId: 'exec-current',
        launchedAt: 123,
        brokerTokenHash: null,
      }),
    ).toEqual({ stamped: true });

    const update = statements.find((statement) =>
      statement.text.includes('UPDATE app.automation_runs SET'),
    );
    expect(update?.text).toContain('detail = CASE WHEN detail = ? THEN ?');
    expect(update?.values).toEqual(
      expect.arrayContaining(['room:agent', 'agent:agent']),
    );
    // The run view refreshes: its park changed under it.
    expect(
      statements.some((statement) =>
        statement.text.includes('INSERT INTO app_realtime.outbox'),
      ),
    ).toBe(true);
  });
});
