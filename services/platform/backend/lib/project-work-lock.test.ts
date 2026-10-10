// @vitest-environment node

/**
 * The project's work key: one transaction-level advisory lock per project,
 * in the retry queue's lock class, so a conflict marked with it queues the
 * retry behind the writer it lost to.
 */

import {
  RETRY_QUEUE_LOCK_CLASS,
  retryQueueKeysOf,
} from '@tale/shared/db/serializable';
import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  lockProjectWork,
  projectWorkQueueKey,
  queueOnProjectWork,
  tryLockProjectWork,
} from './project-work-lock.ts';

function fakeTx(answer: unknown[] = []): {
  tx: TransactionSql;
  statements: { text: string; values: unknown[] }[];
} {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(answer);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-member stand-in for the postgres.js tag
  return { tx: tag as unknown as TransactionSql, statements };
}

describe('the project work key', () => {
  it('names one project, never the organization', () => {
    expect(projectWorkQueueKey('p-1')).toBe('project-work:p-1');
    expect(projectWorkQueueKey('p-1')).not.toBe(projectWorkQueueKey('p-2'));
  });

  it('locks in the retry queue’s class, until the transaction ends', async () => {
    const { tx, statements } = fakeTx();
    await lockProjectWork(tx, 'p-1');
    expect(statements).toEqual([
      {
        text: 'SELECT pg_advisory_xact_lock(?, hashtext(?))',
        values: [RETRY_QUEUE_LOCK_CLASS, 'project-work:p-1'],
      },
    ]);
  });

  it('tries without waiting, and holds only on an explicit true', async () => {
    await expect(
      tryLockProjectWork(fakeTx([{ locked: true }]).tx, 'p-1'),
    ).resolves.toBe(true);
    await expect(
      tryLockProjectWork(fakeTx([{ locked: false }]).tx, 'p-1'),
    ).resolves.toBe(false);
    await expect(tryLockProjectWork(fakeTx([]).tx, 'p-1')).resolves.toBe(false);
  });

  it('marks a conflict with the key, so the retry queues behind the winner', () => {
    const failure = Object.assign(new Error('could not serialize'), {
      code: '40001',
    });
    expect(retryQueueKeysOf(queueOnProjectWork(failure, 'p-1'))).toEqual([
      'project-work:p-1',
    ]);
  });
});
