import { describe, expect, it, vi } from 'vitest';

import { callSiteOf, isTransientDbError, withRetry } from './retry.ts';

const noSleep = (): Promise<void> => Promise.resolve();

function connErr(code: string): Error {
  const err: Error & { code?: string } = new Error(`connection error ${code}`);
  err.code = code;
  return err;
}

describe('isTransientDbError', () => {
  it('classifies postgres connection SQLSTATEs as transient', () => {
    expect(isTransientDbError(connErr('08006'))).toBe(true); // connection_failure
    expect(isTransientDbError(connErr('57P01'))).toBe(true); // admin_shutdown
  });

  it('classifies node socket errors as transient', () => {
    expect(isTransientDbError(connErr('ECONNRESET'))).toBe(true);
    expect(isTransientDbError(connErr('ETIMEDOUT'))).toBe(true);
  });

  it('classifies timeout messages as transient', () => {
    expect(isTransientDbError(new Error('query timed out'))).toBe(true);
  });

  it('does not classify a unique-violation as transient', () => {
    expect(isTransientDbError(connErr('23505'))).toBe(false);
  });

  it('does not classify non-Error values as transient', () => {
    expect(isTransientDbError('boom')).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns the operation result on success', async () => {
    const op = vi.fn(async () => 42);
    expect(await withRetry(op, { sleep: noSleep })).toBe(42);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries on a transient error then succeeds', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(connErr('ECONNRESET'))
      .mockResolvedValueOnce('ok');
    expect(await withRetry(op, { attempts: 3, sleep: noSleep })).toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient error', async () => {
    const op = vi.fn().mockRejectedValue(connErr('23505'));
    await expect(
      withRetry(op, { attempts: 3, sleep: noSleep }),
    ).rejects.toThrow();
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting attempts', async () => {
    const op = vi.fn().mockRejectedValue(connErr('08006'));
    await expect(
      withRetry(op, { attempts: 3, sleep: noSleep }),
    ).rejects.toThrow();
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('stops doubling the delay at maxDelayMs', async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const op = vi
      .fn()
      .mockRejectedValueOnce(connErr('57P03'))
      .mockRejectedValueOnce(connErr('57P03'))
      .mockRejectedValueOnce(connErr('57P03'))
      .mockRejectedValueOnce(connErr('57P03'))
      .mockResolvedValueOnce('ok');
    expect(
      await withRetry(op, {
        attempts: 5,
        baseDelayMs: 100,
        maxDelayMs: 250,
        sleep,
      }),
    ).toBe('ok');
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200, 250, 250]);
  });

  it('retries at the capped delay until the budget runs out', async () => {
    let now = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });
    const op = vi.fn().mockRejectedValue(connErr('57P03'));
    try {
      await expect(
        withRetry(op, {
          attempts: Number.POSITIVE_INFINITY,
          baseDelayMs: 1000,
          maxDelayMs: 1000,
          timeoutMs: 3500,
          sleep,
        }),
      ).rejects.toThrow('connection error 57P03');
      // Attempts at 0, 1, 2 and 3 s; a fourth wait would end past the budget.
      expect(op).toHaveBeenCalledTimes(4);
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 1000, 1000]);
      // An unbounded count names no total it could reach.
      expect(warn).toHaveBeenNthCalledWith(
        1,
        expect.stringMatching(
          /^\[db\] transient error on attempt 1, retrying in 1000ms \(db\/retry\.test\.ts:\d+\): connection error 57P03$/,
        ),
      );
    } finally {
      clock.mockRestore();
      warn.mockRestore();
    }
  });
});

describe('callSiteOf', () => {
  const withStack = (...frames: string[]) =>
    Object.assign(new Error('could not serialize access'), {
      stack: ['Error: could not serialize access', ...frames].join('\n'),
    });

  it('names the application frame that wrote the statement, relative to its service', () => {
    const error = withStack(
      '    at cachedError (/repo/node_modules/postgres/src/query.js:170:23)',
      '    at new Query (/repo/node_modules/postgres/src/query.js:36:24)',
      '    at sql (/repo/node_modules/postgres/src/index.js:112:11)',
      '    at <anonymous> (/repo/services/platform/backend/domains/chat/store.ts:655:17)',
      '    at async transactSerializable (/repo/packages/shared/src/db/serializable.ts:360:12)',
    );

    expect(callSiteOf(error)).toBe('domains/chat/store.ts:655');
  });

  it('skips the retry plumbing, Node’s own frames and dependencies', () => {
    const error = withStack(
      '    at async withRetry (/repo/packages/shared/src/db/retry.ts:101:18)',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
      '    at async Promise.all (index 0)',
      '    at async attempt (file:///repo/packages/shared/src/db/serializable.ts:351:7)',
      '    at async run (file:///repo/services/platform/lib/chat/turn.ts:90:5)',
    );

    expect(callSiteOf(error)).toBe('lib/chat/turn.ts:90');
  });

  it('keeps another package’s file legible', () => {
    const error = withStack(
      '    at tx (/repo/packages/ui/src/server/something.ts:12:3)',
    );

    expect(callSiteOf(error)).toBe('server/something.ts:12');
  });

  it('says nothing when no frame belongs to the application', () => {
    expect(
      callSiteOf(
        withStack('    at x (/repo/node_modules/postgres/src/query.js:1:1)'),
      ),
    ).toBeUndefined();
    expect(
      callSiteOf(Object.assign(new Error('x'), { stack: undefined })),
    ).toBeUndefined();
    expect(callSiteOf('not an error')).toBeUndefined();
  });
});
