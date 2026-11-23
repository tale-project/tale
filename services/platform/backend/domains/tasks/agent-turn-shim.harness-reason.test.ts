// @vitest-environment node

/**
 * The reason a task run's kick recorded for its harness
 * (`project_agent_runs.harness_reason`, migration 0241), as each of the run's
 * turns reads it for the op it opens: the fresh start and a steer's restart
 * record what the kick decided, never the rule read again.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { agentTurnShimHandlers } from './agent-turn-shim.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(rows: Record<string, unknown>[]): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const fn = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    statements.push({ text: strings.join('?'), values });
    return Promise.resolve(rows);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: fn as unknown as Sql, statements };
}

async function runReason(
  rows: Record<string, unknown>[],
): Promise<{ reason: unknown; statements: Statement[] }> {
  const fake = fakeSql(rows);
  const handler = agentTurnShimHandlers(fake.sql)[
    'tasks/agent_runs:getTaskAgentRunHarnessReason'
  ];
  if (handler === undefined) {
    throw new Error('getTaskAgentRunHarnessReason is not wired');
  }
  const reason = await handler({ organizationId: 'org-1', runId: 'run-1' });
  return { reason, statements: fake.statements };
}

describe('getTaskAgentRunHarnessReason', () => {
  it('answers the reason the run’s kick recorded, read from the run of this organization', async () => {
    const { reason, statements } = await runReason([
      { harnessReason: 'model_bound' },
    ]);
    expect(reason).toBe('model_bound');
    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain('FROM app.project_agent_runs');
    expect(statements[0]?.values).toEqual(['run-1', 'org-1']);
  });

  it('answers null for a run an earlier image kicked, one that is gone, and a value it does not know', async () => {
    expect((await runReason([{ harnessReason: null }])).reason).toBeNull();
    expect((await runReason([])).reason).toBeNull();
    expect(
      (await runReason([{ harnessReason: 'a-rule-nobody-wrote' }])).reason,
    ).toBeNull();
  });
});
