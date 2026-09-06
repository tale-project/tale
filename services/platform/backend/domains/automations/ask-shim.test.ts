// @vitest-environment node

/**
 * Unit lock for `createAskForExec`'s write shape (ask-integrity class): ONE
 * statement — an INSERT … ON CONFLICT (session_id, exec_id) WHERE status =
 * 'pending' DO UPDATE — never a SELECT-then-INSERT that two ask_human calls
 * racing inside one turn could both pass (the leftover was a second pending
 * ask nothing ever read, its bells unread forever). `inserted` (xmax = 0)
 * tells a fold from a create. The real-Postgres probe proves the concurrent
 * convergence on the actual index (migration 0082).
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { automationAskShimHandlers } from './ask-shim.ts';

vi.mock('../collab/service.ts', () => ({
  notifyAgentQuestionAsked: vi.fn(() => Promise.resolve(0)),
}));

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(landing: 'inserted' | 'folded'): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const fn = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('FROM app.sandbox_sessions')) {
      return Promise.resolve([
        { ownerType: 'workflow_run', ownerId: 'run_1:@workflow' },
      ]);
    }
    if (text.includes('SELECT status, checkpoints')) {
      return Promise.resolve([
        {
          status: 'waiting',
          checkpoints: { cursor: { node: 'ask', agent: { execId: 'exec_1' } } },
          taskId: null,
        },
      ]);
    }
    if (text.includes('INSERT INTO app.automation_human_asks')) {
      return Promise.resolve([
        {
          id: 'ask_1',
          question:
            landing === 'folded' ? 'Earlier?\n\n---\n\nLater?' : 'Later?',
          inserted: landing === 'inserted',
        },
      ]);
    }
    return Promise.resolve([]);
  };
  fn.json = (value: unknown): unknown => value;
  return { sql: fn as unknown as Sql, statements };
}

const ask = (sql: Sql): Promise<unknown> =>
  automationAskShimHandlers(sql)['automations/human_asks:createAskForExec']?.({
    organizationId: 'org_1',
    sessionId: 'sess_1',
    question: 'Later?',
  }) ?? Promise.reject(new Error('handler missing'));

describe('createAskForExec', () => {
  it('records the ask with one INSERT … ON CONFLICT fold, never a pending SELECT', async () => {
    const fake = fakeSql('inserted');
    await expect(ask(fake.sql)).resolves.toEqual({
      askId: 'ask_1',
      question: 'Later?',
      folded: false,
    });

    const writes = fake.statements.filter((statement) =>
      statement.text.includes('app.automation_human_asks'),
    );
    expect(writes).toHaveLength(1);
    const [insert] = writes;
    expect(insert?.text).toContain(
      "ON CONFLICT (session_id, exec_id) WHERE status = 'pending' DO UPDATE SET",
    );
    expect(insert?.text).toContain('(xmax = 0) AS inserted');
    expect(insert?.values).toContain('sess_1');
    expect(insert?.values).toContain('exec_1');
  });

  it('reports a fold when the row already existed', async () => {
    const fake = fakeSql('folded');
    await expect(ask(fake.sql)).resolves.toEqual({
      askId: 'ask_1',
      question: 'Later?',
      folded: true,
    });
  });
});
