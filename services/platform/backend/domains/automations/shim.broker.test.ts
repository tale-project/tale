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
