import type { ReservedSql, TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  isSerializationFailure,
  markRetryQueueKey,
  RETRY_QUEUE_LOCK_CLASS,
  retryQueueKeyOf,
  retryQueueKeysOf,
  transactSerializable,
  type SerializableTransactionRunner,
} from './serializable.ts';

const noSleep = (): Promise<void> => Promise.resolve();

function sqlstateError(code: string): Error {
  const err: Error & { code?: string } = new Error(`sqlstate ${code}`);
  err.code = code;
  return err;
}

/**
 * Stub runner whose `begin` fails with the queued errors before succeeding.
 * Records the isolation options string of every attempt.
 */
function createRunner(failures: Error[]): {
  runner: SerializableTransactionRunner;
  attempts: () => number;
  optionsSeen: () => readonly string[];
} {
  const queue = [...failures];
  let attempts = 0;
  const optionsSeen: string[] = [];
  const runner: SerializableTransactionRunner = {
    begin: async <T>(
      options: string,
      callback: (tx: TransactionSql) => Promise<T>,
    ): Promise<T> => {
      attempts += 1;
      optionsSeen.push(options);
      const failure = queue.shift();
      if (failure) {
        throw failure;
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- unconstructable third-party branded type, value unused by callbacks
      return callback({} as TransactionSql);
    },
  };
  return {
    runner,
    attempts: () => attempts,
    optionsSeen: () => optionsSeen,
  };
}

describe('isSerializationFailure', () => {
  it('recognizes 40001 and 40P01', () => {
    expect(isSerializationFailure(sqlstateError('40001'))).toBe(true);
    expect(isSerializationFailure(sqlstateError('40P01'))).toBe(true);
  });

  it('rejects other SQLSTATEs and non-errors', () => {
    expect(isSerializationFailure(sqlstateError('23505'))).toBe(false);
    expect(isSerializationFailure(new Error('no code'))).toBe(false);
    expect(isSerializationFailure('40001')).toBe(false);
  });
});

describe('transactSerializable', () => {
  it('runs at serializable isolation and returns the callback result', async () => {
    const { runner, optionsSeen } = createRunner([]);
    const result = await transactSerializable(runner, () =>
      Promise.resolve('ok'),
    );
    expect(result).toBe('ok');
    expect(optionsSeen()).toEqual(['isolation level serializable']);
  });

  it('retries the whole transaction on serialization failures', async () => {
    const { runner, attempts } = createRunner([
      sqlstateError('40001'),
      sqlstateError('40P01'),
    ]);
    const result = await transactSerializable(
      runner,
      () => Promise.resolve(42),
      { sleep: noSleep },
    );
    expect(result).toBe(42);
    expect(attempts()).toBe(3);
  });

  it('propagates non-retryable errors immediately', async () => {
    const { runner, attempts } = createRunner([sqlstateError('23505')]);
    await expect(
      transactSerializable(runner, () => Promise.resolve('unreached'), {
        sleep: noSleep,
      }),
    ).rejects.toThrow('sqlstate 23505');
    expect(attempts()).toBe(1);
  });

  it('gives up after the configured attempts', async () => {
    const { runner, attempts } = createRunner([
      sqlstateError('40001'),
      sqlstateError('40001'),
      sqlstateError('40001'),
    ]);
    await expect(
      transactSerializable(runner, () => Promise.resolve('unreached'), {
        attempts: 3,
        sleep: noSleep,
      }),
    ).rejects.toThrow('sqlstate 40001');
    expect(attempts()).toBe(3);
  });

  it('still retries transient connection faults', async () => {
    const connReset: Error & { code?: string } = new Error('connection reset');
    connReset.code = 'ECONNRESET';
    const { runner, attempts } = createRunner([connReset]);
    const result = await transactSerializable(
      runner,
      () => Promise.resolve('ok'),
      { sleep: noSleep },
    );
    expect(result).toBe('ok');
    expect(attempts()).toBe(2);
  });
});

interface Statement {
  text: string;
  values: unknown[];
}

/**
 * Recording fake of one reserved connection: the tagged template and
 * `unsafe` both log the statement; `unsafe` answers with the command tag a
 * server would (overridable for COMMIT), `release` counts.
 */
function createReserved(
  commitAnswer = 'COMMIT',
  failOn?: (text: string, values: unknown[]) => Error | undefined,
): {
  reserved: ReservedSql;
  statements: Statement[];
  released: () => number;
} {
  const statements: Statement[] = [];
  let released = 0;
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
    const failure = failOn?.(text, values);
    return failure === undefined
      ? Promise.resolve([])
      : Promise.reject(failure);
  };
  tag.unsafe = (text: string) => {
    statements.push({ text, values: [] });
    const command = text.split(' ')[0] ?? '';
    return Promise.resolve({
      command: command === 'COMMIT' ? commitAnswer : command,
    });
  };
  tag.release = () => {
    released += 1;
  };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- unconstructable third-party branded type; only the members the runner uses exist
    reserved: tag as unknown as ReservedSql,
    statements,
    released: () => released,
  };
}

/**
 * Runner whose `begin` fails with the queued errors; `reserve` hands out a
 * fresh recording connection per call.
 */
function createQueueRunner(
  failures: Error[],
  options: {
    commitAnswer?: string;
    failOn?: (text: string, values: unknown[]) => Error | undefined;
  } = {},
): {
  runner: SerializableTransactionRunner;
  beginAttempts: () => number;
  reservations: ReturnType<typeof createReserved>[];
} {
  const { runner, attempts } = createRunner(failures);
  const reservations: ReturnType<typeof createReserved>[] = [];
  const queued: SerializableTransactionRunner = {
    begin: <T>(
      isolation: string,
      callback: (tx: TransactionSql) => Promise<T>,
    ): Promise<T> => runner.begin(isolation, callback),
    reserve: () => {
      const reservation = createReserved(options.commitAnswer, options.failOn);
      reservations.push(reservation);
      return Promise.resolve(reservation.reserved);
    },
  };
  return { runner: queued, beginAttempts: attempts, reservations };
}

const texts = (statements: Statement[]): string[] =>
  statements.map((s) => s.text);

const queueKey = 'audit-chain:org_1';

describe('markRetryQueueKey', () => {
  it('marks serialization failures only', () => {
    expect(
      retryQueueKeyOf(markRetryQueueKey(sqlstateError('40001'), 'k')),
    ).toBe('k');
    expect(
      retryQueueKeyOf(markRetryQueueKey(sqlstateError('40P01'), 'k')),
    ).toBe('k');
    expect(
      retryQueueKeyOf(markRetryQueueKey(sqlstateError('23505'), 'k')),
    ).toBeUndefined();
    expect(retryQueueKeyOf('40001')).toBeUndefined();
    expect(retryQueueKeyOf(null)).toBeUndefined();
  });

  it('returns the same error object', () => {
    const error = sqlstateError('40001');
    expect(markRetryQueueKey(error, 'k')).toBe(error);
  });
});

describe('transactSerializable — retry queues', () => {
  it('runs the retry after a marked failure queued on the key', async () => {
    const { runner, beginAttempts, reservations } = createQueueRunner([
      markRetryQueueKey(sqlstateError('40001'), queueKey),
    ]);
    const result = await transactSerializable(
      runner,
      async (tx) => {
        await tx`SELECT 1`;
        return 'ok';
      },
      { sleep: noSleep },
    );
    expect(result).toBe('ok');
    expect(beginAttempts()).toBe(1);
    expect(reservations).toHaveLength(1);
    const [reservation] = reservations;
    expect(texts(reservation?.statements ?? [])).toEqual([
      'SELECT pg_advisory_lock(?, hashtext(?))',
      'BEGIN ISOLATION LEVEL SERIALIZABLE',
      'SELECT 1',
      'COMMIT',
      'SELECT pg_advisory_unlock(?, hashtext(?))',
    ]);
    expect(reservation?.statements[0]?.values).toEqual([
      RETRY_QUEUE_LOCK_CLASS,
      queueKey,
    ]);
    expect(reservation?.statements[4]?.values).toEqual([
      RETRY_QUEUE_LOCK_CLASS,
      queueKey,
    ]);
    expect(reservation?.released()).toBe(1);
  });

  it('retries an unmarked failure plainly, never reserving', async () => {
    const { runner, beginAttempts, reservations } = createQueueRunner([
      sqlstateError('40001'),
    ]);
    await transactSerializable(runner, () => Promise.resolve('ok'), {
      sleep: noSleep,
    });
    expect(beginAttempts()).toBe(2);
    expect(reservations).toHaveLength(0);
  });

  it('retries plainly when the runner cannot reserve', async () => {
    const { runner, attempts } = createRunner([
      markRetryQueueKey(sqlstateError('40001'), queueKey),
    ]);
    await transactSerializable(runner, () => Promise.resolve('ok'), {
      sleep: noSleep,
    });
    expect(attempts()).toBe(2);
  });

  it('stays queued once queued, rolling back a failed queued attempt', async () => {
    const { runner, beginAttempts, reservations } = createQueueRunner([
      markRetryQueueKey(sqlstateError('40001'), queueKey),
    ]);
    let calls = 0;
    const result = await transactSerializable(
      runner,
      () => {
        calls += 1;
        // The first queued attempt loses on something else entirely.
        return calls === 1
          ? Promise.reject(sqlstateError('40001'))
          : Promise.resolve('ok');
      },
      { sleep: noSleep },
    );
    expect(result).toBe('ok');
    expect(beginAttempts()).toBe(1);
    expect(reservations).toHaveLength(2);
    expect(texts(reservations[0]?.statements ?? [])).toEqual([
      'SELECT pg_advisory_lock(?, hashtext(?))',
      'BEGIN ISOLATION LEVEL SERIALIZABLE',
      'ROLLBACK',
      'SELECT pg_advisory_unlock(?, hashtext(?))',
    ]);
    expect(reservations[0]?.released()).toBe(1);
    expect(texts(reservations[1]?.statements ?? [])).toContain('COMMIT');
    expect(reservations[1]?.released()).toBe(1);
  });

  it('rolls back, unlocks and releases when the queued callback fails for good', async () => {
    const { runner, reservations } = createQueueRunner([
      markRetryQueueKey(sqlstateError('40001'), queueKey),
    ]);
    await expect(
      transactSerializable(runner, () => Promise.reject(new Error('boom')), {
        sleep: noSleep,
      }),
    ).rejects.toThrow('boom');
    expect(reservations).toHaveLength(1);
    expect(texts(reservations[0]?.statements ?? [])).toEqual([
      'SELECT pg_advisory_lock(?, hashtext(?))',
      'BEGIN ISOLATION LEVEL SERIALIZABLE',
      'ROLLBACK',
      'SELECT pg_advisory_unlock(?, hashtext(?))',
    ]);
    expect(reservations[0]?.released()).toBe(1);
  });

  it('never reports success when the server answers COMMIT with ROLLBACK', async () => {
    const { runner, reservations } = createQueueRunner(
      [markRetryQueueKey(sqlstateError('40001'), queueKey)],
      { commitAnswer: 'ROLLBACK' },
    );
    await expect(
      transactSerializable(runner, () => Promise.resolve('unreached'), {
        sleep: noSleep,
      }),
    ).rejects.toThrow('did not commit');
    expect(texts(reservations[0]?.statements ?? []).at(-1)).toBe(
      'SELECT pg_advisory_unlock(?, hashtext(?))',
    );
    expect(reservations[0]?.released()).toBe(1);
  });

  it('gives a queued transaction postgres.js-shaped savepoints', async () => {
    const { runner, reservations } = createQueueRunner([
      markRetryQueueKey(sqlstateError('40001'), queueKey),
    ]);
    await transactSerializable(
      runner,
      async (tx) => {
        await tx.savepoint(async (sp) => {
          await sp`SELECT 2`;
        });
        await expect(
          tx.savepoint('inner', () => Promise.reject(new Error('undo'))),
        ).rejects.toThrow('undo');
        await expect(
          tx.savepoint('not valid', () => Promise.resolve()),
        ).rejects.toThrow('invalid savepoint name');
        return 'ok';
      },
      { sleep: noSleep },
    );
    expect(texts(reservations[0]?.statements ?? [])).toEqual([
      'SELECT pg_advisory_lock(?, hashtext(?))',
      'BEGIN ISOLATION LEVEL SERIALIZABLE',
      'SAVEPOINT s0',
      'SELECT 2',
      'RELEASE SAVEPOINT s0',
      'SAVEPOINT s1_inner',
      'ROLLBACK TO SAVEPOINT s1_inner',
      'COMMIT',
      'SELECT pg_advisory_unlock(?, hashtext(?))',
    ]);
  });
});

describe('markRetryQueueKey — nested keys', () => {
  it('prepends an outer mark so the list reads outermost first', () => {
    const error = markRetryQueueKey(
      markRetryQueueKey(sqlstateError('40001'), 'audit-chain:org_1'),
      'task-comment:t_1',
    );
    expect(retryQueueKeysOf(error)).toEqual([
      'task-comment:t_1',
      'audit-chain:org_1',
    ]);
    expect(retryQueueKeyOf(error)).toBe('task-comment:t_1');
  });

  it('never adds a key twice', () => {
    const error = markRetryQueueKey(
      markRetryQueueKey(sqlstateError('40001'), 'k'),
      'k',
    );
    expect(retryQueueKeysOf(error)).toEqual(['k']);
    expect(retryQueueKeysOf(sqlstateError('40001'))).toEqual([]);
    expect(retryQueueKeysOf(undefined)).toEqual([]);
  });
});

describe('transactSerializable — nested retry queues', () => {
  it('locks every key in order before BEGIN and unlocks in reverse', async () => {
    const { runner, beginAttempts, reservations } = createQueueRunner([
      markRetryQueueKey(
        markRetryQueueKey(sqlstateError('40001'), 'audit-chain:org_1'),
        'task-comment:t_1',
      ),
    ]);
    const result = await transactSerializable(
      runner,
      async (tx) => {
        await tx`SELECT 1`;
        return 'ok';
      },
      { sleep: noSleep },
    );
    expect(result).toBe('ok');
    expect(beginAttempts()).toBe(1);
    const statements = reservations[0]?.statements ?? [];
    expect(texts(statements)).toEqual([
      'SELECT pg_advisory_lock(?, hashtext(?))',
      'SELECT pg_advisory_lock(?, hashtext(?))',
      'BEGIN ISOLATION LEVEL SERIALIZABLE',
      'SELECT 1',
      'COMMIT',
      'SELECT pg_advisory_unlock(?, hashtext(?))',
      'SELECT pg_advisory_unlock(?, hashtext(?))',
    ]);
    expect(statements.map((s) => s.values[1])).toEqual([
      'task-comment:t_1',
      'audit-chain:org_1',
      undefined,
      undefined,
      undefined,
      'audit-chain:org_1',
      'task-comment:t_1',
    ]);
    expect(reservations[0]?.released()).toBe(1);
  });
});

describe('transactSerializable — nested retry queues, failure paths', () => {
  const nested = (): Error =>
    markRetryQueueKey(
      markRetryQueueKey(sqlstateError('40001'), 'audit-chain:org_1'),
      'task-comment:t_1',
    );

  it('releases the keys it already holds when a later key cannot be locked', async () => {
    const cancelled = sqlstateError('57014');
    const { runner, beginAttempts, reservations } = createQueueRunner(
      [nested()],
      {
        failOn: (text, values) =>
          text.startsWith('SELECT pg_advisory_lock') &&
          values[1] === 'audit-chain:org_1'
            ? cancelled
            : undefined,
      },
    );
    await expect(
      transactSerializable(runner, () => Promise.resolve('never'), {
        sleep: noSleep,
      }),
    ).rejects.toBe(cancelled);
    expect(beginAttempts()).toBe(1);
    // A cancelled statement is not transient: no second attempt of any kind.
    expect(reservations).toHaveLength(1);
    const statements = reservations[0]?.statements ?? [];
    expect(texts(statements)).toEqual([
      'SELECT pg_advisory_lock(?, hashtext(?))',
      'SELECT pg_advisory_lock(?, hashtext(?))',
      'SELECT pg_advisory_unlock(?, hashtext(?))',
    ]);
    expect(statements[2]?.values[1]).toBe('task-comment:t_1');
    expect(reservations[0]?.released()).toBe(1);
  });

  it('keeps the fuller key list when a queued attempt is re-marked with a subset', async () => {
    const { runner, reservations } = createQueueRunner([nested()]);
    let queuedCalls = 0;
    const result = await transactSerializable(
      runner,
      () => {
        queuedCalls += 1;
        // The first queued attempt loses to a writer outside the inner
        // queue and is marked with the outer key alone.
        return queuedCalls === 1
          ? Promise.reject(
              markRetryQueueKey(sqlstateError('40001'), 'task-comment:t_1'),
            )
          : Promise.resolve('ok');
      },
      { sleep: noSleep },
    );
    expect(result).toBe('ok');
    expect(reservations).toHaveLength(2);
    const locks = (reservations[1]?.statements ?? [])
      .filter((s) => s.text.startsWith('SELECT pg_advisory_lock'))
      .map((s) => s.values[1]);
    expect(locks).toEqual(['task-comment:t_1', 'audit-chain:org_1']);
  });
});
