// @vitest-environment node

/**
 * The task comment queue's contract with the shared retry queue: the task
 * key is locked before anything else, a serialization failure inside the
 * write carries the task key in front of any key an inner write (the org's
 * audit chain head) already put on it, and other failures pass untouched.
 */

import {
  RETRY_QUEUE_LOCK_CLASS,
  markRetryQueueKey,
  retryQueueKeysOf,
} from '@tale/shared/db/serializable';
import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  lockTaskCommentQueue,
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

  it('keeps an inner audit mark behind the task key', async () => {
    const { tx } = fakeTx();
    const failure = await queuedOnTask(tx, 't_1', () =>
      Promise.reject(
        markRetryQueueKey(sqlstateError('40001'), 'audit-chain:org_1'),
      ),
    ).catch((error: unknown) => error);
    expect(retryQueueKeysOf(failure)).toEqual([
      taskCommentQueueKey('t_1'),
      'audit-chain:org_1',
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
