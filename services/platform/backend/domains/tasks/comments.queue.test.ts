// @vitest-environment node

/**
 * The task comment queue's contract with the shared retry queue: the task
 * key is locked before anything else, a serialization failure inside the
 * write carries the task key in front of any key an inner write (a
 * project's work key) already put on it, and other failures pass untouched.
 * A comment write then holds its organization's comment key shared, and
 * queues a loss anywhere in it on its task and on that key.
 */

import {
  RETRY_QUEUE_LOCK_CLASS,
  markRetryQueueKey,
  retryQueueKeysOf,
} from '@tale/shared/db/serializable';
import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  addTaskComment,
  deleteTaskComment,
  lockTaskCommentQueue,
  orgCommentQueueKey,
  queuedOnTask,
  taskCommentQueueKey,
} from './comments.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeTx(): { tx: TransactionSql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings
      .reduce(
        (acc, part, index) =>
          `${acc}${part}${index < values.length ? '?' : ''}`,
        '',
      )
      .replace(/\s+/g, ' ')
      .trim();
    statements.push({ text, values });
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call is exercised
  return { tx: tag as unknown as TransactionSql, statements };
}

function sqlstateError(code: string): Error {
  const error: Error & { code?: string } = new Error(`sqlstate ${code}`);
  error.code = code;
  return error;
}

describe('queuedOnTask', () => {
  it("takes the task's queue lock before the work runs", async () => {
    const { tx, statements } = fakeTx();
    const order: string[] = [];
    const result = await queuedOnTask(tx, 't_1', () => {
      order.push(`work after ${statements.length} statement(s)`);
      return Promise.resolve('done');
    });
    expect(result).toBe('done');
    expect(statements).toEqual([
      {
        text: 'SELECT pg_advisory_xact_lock(?, hashtext(?))',
        values: [RETRY_QUEUE_LOCK_CLASS, taskCommentQueueKey('t_1')],
      },
    ]);
    expect(order).toEqual(['work after 1 statement(s)']);
  });

  it('marks a serialization failure with the task key', async () => {
    const { tx } = fakeTx();
    const failure = await queuedOnTask(tx, 't_1', () =>
      Promise.reject(sqlstateError('40001')),
    ).catch((error: unknown) => error);
    expect(retryQueueKeysOf(failure)).toEqual([taskCommentQueueKey('t_1')]);
  });

  it('keeps an inner project mark behind the task key', async () => {
    const { tx } = fakeTx();
    const failure = await queuedOnTask(tx, 't_1', () =>
      Promise.reject(
        markRetryQueueKey(sqlstateError('40001'), 'project-work:p_1'),
      ),
    ).catch((error: unknown) => error);
    expect(retryQueueKeysOf(failure)).toEqual([
      taskCommentQueueKey('t_1'),
      'project-work:p_1',
    ]);
  });

  it('leaves other failures unmarked and untouched', async () => {
    const { tx } = fakeTx();
    const boom = sqlstateError('23505');
    const failure = await queuedOnTask(tx, 't_1', () =>
      Promise.reject(boom),
    ).catch((error: unknown) => error);
    expect(failure).toBe(boom);
    expect(retryQueueKeysOf(failure)).toEqual([]);
  });
});

describe('lockTaskCommentQueue', () => {
  it('is the same lock statement the queue takes', async () => {
    const { tx, statements } = fakeTx();
    await lockTaskCommentQueue(tx, 't_9');
    expect(statements[0]?.values).toEqual([
      RETRY_QUEUE_LOCK_CLASS,
      taskCommentQueueKey('t_9'),
    ]);
  });
});

describe('comment writes', () => {
  const auth = {
    organizationId: 'org_1',
    userId: 'u_1',
    role: 'owner',
    teamIds: [],
  };

  /** A transaction whose statements answer `answers` in order, and whose
   * next statement fails with `failure`. */
  function scriptedTx(answers: unknown[][], failure: Error): TransactionSql {
    let calls = 0;
    const tag = () => {
      const answer = answers[calls];
      calls += 1;
      return answer === undefined
        ? Promise.reject(failure)
        : Promise.resolve(answer);
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call and `unsafe` fragments are exercised
    return Object.assign(tag, {
      unsafe: (text: string) => text,
    }) as unknown as TransactionSql;
  }

  it("take the task's lock, then the organization's comment key shared", async () => {
    const { tx, statements } = fakeTx();
    // The task read finds nothing; only the locks before it matter here.
    await addTaskComment(tx, auth, { taskId: 't_1', body: 'hello' }).catch(
      (error: unknown) => error,
    );
    expect(statements.slice(0, 2)).toEqual([
      {
        text: 'SELECT pg_advisory_xact_lock(?, hashtext(?))',
        values: [RETRY_QUEUE_LOCK_CLASS, taskCommentQueueKey('t_1')],
      },
      {
        text: 'SELECT pg_advisory_xact_lock_shared(?, hashtext(?))',
        values: [RETRY_QUEUE_LOCK_CLASS, orgCommentQueueKey('org_1')],
      },
    ]);
  });

  it("queue a loss on the task, then on the organization's comment key", async () => {
    // The task lock answers; the next statement loses to another comment
    // write.
    const failure = await addTaskComment(
      scriptedTx([[]], sqlstateError('40001')),
      auth,
      { taskId: 't_1', body: 'hello' },
    ).catch((error: unknown) => error);
    expect(retryQueueKeysOf(failure)).toEqual([
      taskCommentQueueKey('t_1'),
      orgCommentQueueKey('org_1'),
    ]);
  });

  it("queue a lost delete on the task and the organization's comment key", async () => {
    const meta = {
      taskId: 't_1',
      authorType: 'user',
      authorId: 'u_1',
      mentions: null,
    };
    const failure = await deleteTaskComment(
      scriptedTx([[meta], []], sqlstateError('40P01')),
      auth,
      'm_1',
    ).catch((error: unknown) => error);
    expect(retryQueueKeysOf(failure)).toEqual([
      taskCommentQueueKey('t_1'),
      orgCommentQueueKey('org_1'),
    ]);
  });

  it('leave other failures unmarked', async () => {
    const boom = sqlstateError('23505');
    const failure = await addTaskComment(scriptedTx([[]], boom), auth, {
      taskId: 't_1',
      body: 'hello',
    }).catch((error: unknown) => error);
    expect(failure).toBe(boom);
    expect(retryQueueKeysOf(failure)).toEqual([]);
  });
});
