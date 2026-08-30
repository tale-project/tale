import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  isSerializationFailure,
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
