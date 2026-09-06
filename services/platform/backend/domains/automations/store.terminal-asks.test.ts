// @vitest-environment node

/**
 * Unit lock for the terminal doors' ask contract (dead-end class): a run
 * that ends — cancelled or finished — closes every pending ask it parked on
 * (`cancelled`) and reads the recipients' `agent_escalation` bells inside
 * the same transaction. Regression: a cancel during an ask park left the
 * ask `pending` forever (answerable, enqueueing a resume for a dead run)
 * with its bells unread — no `closeAsk` path fires for it. The real-Postgres
 * probe drives the HTTP cancel over the actual rows.
 */

import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { cancelRunInTx, finishRun } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** Scripted transaction handle: the run flips, one pending ask closes, one
 * recipient's bell is unread; everything else answers empty. */
function fakeTx(runStatus: string): {
  tx: TransactionSql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tx = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('FROM app.automation_runs')) {
      return Promise.resolve(
        runStatus === 'missing'
          ? []
          : [
              {
                id: 'run_1',
                organizationId: 'org_1',
                name: 'ops/ask',
                version: 1,
                status: runStatus,
                mode: 'mock',
                startedBy: 'user_1',
                checkpoints: { nodes: {}, executions: 1 },
                claimEpoch: 1,
                chainSeq: 0,
              },
            ],
      );
    }
    if (text.includes('UPDATE app.automation_runs SET')) {
      return Promise.resolve(
        runStatus === 'missing'
          ? []
          : [
              {
                name: 'ops/ask',
                version: 1,
                mode: 'mock',
                startedBy: 'user_1',
              },
            ],
      );
    }
    if (text.includes('UPDATE app.automation_human_asks SET')) {
      return Promise.resolve([{ id: 'ask_1' }]);
    }
    if (text.includes('UPDATE app.user_notifications SET')) {
      return Promise.resolve([{ id: 'n_1', userId: 'user_2' }]);
    }
    return Promise.resolve([]);
  };
  tx.json = (value: unknown): unknown => value;
  tx.unsafe = (text: string): string => text;
  return { tx: tx as unknown as TransactionSql, statements };
}

function askClosure(statements: Statement[]): {
  closed: Statement | undefined;
  dismissed: Statement | undefined;
} {
  return {
    closed: statements.find((statement) =>
      statement.text.includes('UPDATE app.automation_human_asks SET'),
    ),
    dismissed: statements.find((statement) =>
      statement.text.includes('UPDATE app.user_notifications SET'),
    ),
  };
}

describe('terminal doors close pending asks', () => {
  it('cancelRunInTx cancels the pending asks and reads their bells', async () => {
    const fake = fakeTx('waiting');
    await expect(cancelRunInTx(fake.tx, 'org_1', 'run_1')).resolves.toEqual({
      cancelled: true,
    });

    const { closed, dismissed } = askClosure(fake.statements);
    expect(closed?.text).toContain("status = 'cancelled'");
    expect(closed?.text).toContain("status = 'pending'");
    expect(closed?.values).toEqual(['run_1', 'org_1']);
    expect(dismissed?.text).toContain("type = 'agent_escalation'");
    expect(dismissed?.values).toContain('ask_1');
  });

  it('finishRun closes them too', async () => {
    const fake = fakeTx('running');
    const sql = {
      begin: (callback: (handle: TransactionSql) => Promise<unknown>) =>
        callback(fake.tx),
    };
    await expect(
      finishRun(sql as never, {
        organizationId: 'org_1',
        runId: 'run_1',
        epoch: 1,
        status: 'failed',
        trace: [],
        effects: [],
        detail: 'deadline',
        executions: 1,
      }),
    ).resolves.toEqual({ status: 'failed' });

    const { closed, dismissed } = askClosure(fake.statements);
    expect(closed?.text).toContain("status = 'cancelled'");
    expect(dismissed?.values).toContain('ask_1');
  });

  it('touches no ask when the run was not cancellable', async () => {
    const fake = fakeTx('missing');
    await expect(cancelRunInTx(fake.tx, 'org_1', 'run_1')).resolves.toEqual({
      cancelled: false,
    });
    expect(askClosure(fake.statements).closed).toBeUndefined();
  });
});
