import { describe, expect, it, vi } from 'vitest';

import { isTransientDbError, withRetry } from './retry.ts';

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
});
