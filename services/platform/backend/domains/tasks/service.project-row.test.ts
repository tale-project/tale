// @vitest-environment node

/**
 * The project row — its task number counter and its open and done counts —
 * is written only under the project's work key, taken before the row, and a
 * conflict on it queues the retry on that key. Nothing organization-wide is
 * held: task writes of two projects never wait on each other.
 */

import {
  RETRY_QUEUE_LOCK_CLASS,
  retryQueueKeysOf,
} from '@tale/shared/db/serializable';
import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { applyTaskCountTransition, nextTaskNumber } from './service.ts';

function fakeTx(respond: (text: string) => unknown[]): {
  tx: TransactionSql;
  statements: { text: string; values: unknown[] }[];
} {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    try {
      return Promise.resolve(respond(text));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-member stand-in for the postgres.js tag
  return { tx: tag as unknown as TransactionSql, statements };
}

const conflict = () =>
  Object.assign(new Error('could not serialize access'), { code: '40001' });

describe('the project row', () => {
  it('claims the next task number under the project work key, taken first', async () => {
    const { tx, statements } = fakeTx((text) =>
      text.startsWith('UPDATE app.projects') ? [{ taskCounter: 7 }] : [],
    );
    await expect(nextTaskNumber(tx, 'p-1')).resolves.toBe(7);
    expect(statements.map((s) => s.text.slice(0, 40))).toEqual([
      'SELECT pg_advisory_xact_lock(?, hashtext',
      'UPDATE app.projects SET task_counter = t',
    ]);
    expect(statements[0]?.values).toEqual([
      RETRY_QUEUE_LOCK_CLASS,
      'project-work:p-1',
    ]);
  });

  it('moves the open and done counts under the same key', async () => {
    const { tx, statements } = fakeTx(() => []);
    await applyTaskCountTransition(tx, 'p-1', 'open', 'done');
    expect(statements[0]?.values).toEqual([
      RETRY_QUEUE_LOCK_CLASS,
      'project-work:p-1',
    ]);
    expect(statements[1]?.text).toContain('UPDATE app.projects SET');
    expect(statements[1]?.values).toEqual([-1, 1, 'p-1']);
  });

  it('queues a lost counter write on the project key alone', async () => {
    const { tx } = fakeTx((text) => {
      if (text.startsWith('UPDATE app.projects')) throw conflict();
      return [];
    });
    const failure = await nextTaskNumber(tx, 'p-1').catch(
      (error: unknown) => error,
    );
    expect(retryQueueKeysOf(failure)).toEqual(['project-work:p-1']);
    const counts = fakeTx((text) => {
      if (text.startsWith('UPDATE app.projects')) throw conflict();
      return [];
    });
    const lost = await applyTaskCountTransition(
      counts.tx,
      'p-1',
      'none',
      'open',
    ).catch((error: unknown) => error);
    expect(retryQueueKeysOf(lost)).toEqual(['project-work:p-1']);
  });

  it('writes nothing when the bucket does not move', async () => {
    const { tx, statements } = fakeTx(() => []);
    await applyTaskCountTransition(tx, 'p-1', 'open', 'open');
    expect(statements).toHaveLength(0);
  });
});
