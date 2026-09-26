// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { agentTurnShimHandlers } from './agent-turn-shim.ts';

function fakeSql() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({ text: strings.join('?'), values });
    return [
      {
        status: 'running',
        execId: 'exec-1',
        brokerTokenHash: 'selected-account-hash',
      },
    ];
  };
  return { sql: sql as unknown as Sql, statements };
}

describe('task-agent broker account attribution', () => {
  it('projects the selected account hash so the real settle can cool it down', async () => {
    const db = fakeSql();
    const read = agentTurnShimHandlers(db.sql)[
      'tasks/agent_runs:getTaskAgentRunForDrive'
    ];
    expect(await read?.({ runId: 'run-1' })).toMatchObject({
      brokerTokenHash: 'selected-account-hash',
    });
    expect(db.statements[0]?.text).toContain(
      'broker_token_hash AS "brokerTokenHash"',
    );
  });

  it('can clear a predecessor account when the current exec changes credential lanes', async () => {
    const db = fakeSql();
    const stamp = agentTurnShimHandlers(db.sql)[
      'tasks/agent_runs:stampTaskAgentRunBrokerToken'
    ];
    await stamp?.({
      runId: 'run-1',
      execId: 'exec-current',
      brokerTokenHash: null,
    });
    expect(db.statements[0]?.values).toEqual([
      null,
      expect.any(Number),
      'run-1',
      'exec-current',
    ]);
    expect(db.statements[0]?.text).toContain('exec_id = ?');
  });
});
