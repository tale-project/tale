import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, type AccountView } from '@/app/lib/api';

import { useAccounts } from './use-gateway';

const api = vi.hoisted(() => ({ accounts: vi.fn() }));

vi.mock('@/app/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/api')>();
  return { ...actual, gatewayApi: { ...actual.gatewayApi, ...api } };
});

const account: AccountView = {
  id: 'account-1',
  provider: 'anthropic',
  label: 'you@example.com',
  accountEmail: 'you@example.com',
  subscription: { plan: 'max', tier: '20x' },
  status: 'active',
  expiresAt: null,
  scopes: null,
  createdAt: '2026-09-24T10:00:00.000Z',
  lastRefreshedAt: null,
  usage: null,
};

const unreachable = () => new ApiError('unreachable', 'Failed to fetch', 0);

/** Let the list's timer run, and the read it starts settle. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useAccounts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    // Reset, not clear: a test that stops early must not leave its queued
    // answers for the next one to receive.
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it('has no list until a read succeeds', async () => {
    api.accounts.mockRejectedValueOnce(unreachable());
    const { result } = renderHook(() => useAccounts());
    expect(result.current.accounts).toBeNull();
    expect(result.current.error).toBeNull();

    await advance(0);
    expect(result.current.accounts).toBeNull();
    expect(result.current.error).toMatchObject({ code: 'unreachable' });
  });

  it('keeps the rows it read when a later read fails, until one succeeds', async () => {
    api.accounts.mockResolvedValueOnce([account]);
    const { result } = renderHook(() => useAccounts());
    await advance(0);
    expect(result.current.accounts).toEqual([account]);

    // The next minute's read meets the sign-in gate: the rows stay, and the
    // reason rides beside them.
    api.accounts.mockRejectedValueOnce(
      new ApiError('signed_out', 'The sign-in has run out.', 0),
    );
    await advance(60_000);
    expect(result.current.accounts).toEqual([account]);
    expect(result.current.error).toMatchObject({ code: 'signed_out' });

    api.accounts.mockResolvedValueOnce([]);
    await advance(60_000);
    expect(result.current.accounts).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('reads again on demand', async () => {
    api.accounts.mockRejectedValueOnce(unreachable());
    const { result } = renderHook(() => useAccounts());
    await advance(0);

    api.accounts.mockResolvedValueOnce([account]);
    await act(async () => {
      result.current.reload();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.accounts).toEqual([account]);
    expect(result.current.error).toBeNull();
  });

  it('tells the console about the first failure of a run, not each one', async () => {
    api.accounts
      .mockRejectedValueOnce(unreachable())
      .mockRejectedValueOnce(unreachable())
      .mockResolvedValueOnce([account])
      .mockRejectedValueOnce(unreachable());
    renderHook(() => useAccounts());
    await advance(0);
    await advance(60_000);
    expect(console.warn).toHaveBeenCalledTimes(1);

    await advance(60_000);
    await advance(60_000);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});
