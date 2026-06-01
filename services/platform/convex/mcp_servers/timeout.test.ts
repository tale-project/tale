import { describe, expect, it, vi } from 'vitest';

import {
  MCP_CONNECTION_TIMEOUT_MS,
  McpTimeoutError,
  withTimeout,
} from './timeout';

const delay = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const reject = (ms: number, err: Error): Promise<never> =>
  new Promise((_, r) => setTimeout(() => r(err), ms));

describe('McpTimeoutError', () => {
  it('uses the default timeout in its message', () => {
    const err = new McpTimeoutError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('McpTimeoutError');
    expect(err.message).toContain('15s');
  });

  it('renders a rounded seconds value from the given ms', () => {
    expect(new McpTimeoutError(15_000).message).toContain('15s');
    expect(new McpTimeoutError(3_000).message).toContain('3s');
  });
});

describe('withTimeout', () => {
  it('resolves with the operation result when it finishes in time', async () => {
    const onTimeout = vi.fn();
    const result = await withTimeout(delay(5, 'ok'), 200, onTimeout);
    expect(result).toBe('ok');
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('rejects with McpTimeoutError and aborts when the operation is too slow', async () => {
    const onTimeout = vi.fn();
    // Operation never settles within the window.
    await expect(
      withTimeout(delay(1_000, 'late'), 10, onTimeout),
    ).rejects.toBeInstanceOf(McpTimeoutError);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('propagates the operation error when it fails before the timeout', async () => {
    const boom = new Error('connect refused');
    await expect(withTimeout(reject(5, boom), 200)).rejects.toBe(boom);
  });

  it('still rejects with McpTimeoutError if the abort handler throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onTimeout = vi.fn(() => {
      throw new Error('abort failed');
    });
    await expect(
      withTimeout(delay(1_000, 'late'), 10, onTimeout),
    ).rejects.toBeInstanceOf(McpTimeoutError);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('does not leak an unhandled rejection when the aborted operation settles late', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Operation rejects AFTER the timeout has already won the race.
    const op = reject(30, new Error('late abort error'));
    await expect(withTimeout(op, 10)).rejects.toBeInstanceOf(McpTimeoutError);
    // Give the late rejection time to settle and be observed by the
    // internal .catch (otherwise it would become an unhandledRejection).
    await delay(40, null);
    expect(warn).toHaveBeenCalledWith(
      'MCP operation aborted after timeout:',
      'late abort error',
    );
    warn.mockRestore();
  });

  it('exposes a sane default connection timeout', () => {
    expect(MCP_CONNECTION_TIMEOUT_MS).toBe(15_000);
  });
});
