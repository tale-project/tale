// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  // Never resolves — warmSession must not await it.
  getSession: vi.fn(() => new Promise(() => {})),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: h.getSession },
}));

import { sessionQueryOptions, warmSession } from './session-query';

describe('warmSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('kicks the session fetch without awaiting it', () => {
    warmSession();

    // The fetch starts in the same synchronous tick; the pending promise
    // proves nothing downstream is gated on its result (the serial→parallel
    // collapse of epic #2386).
    expect(h.getSession).toHaveBeenCalledTimes(1);
  });
});

describe('sessionQueryOptions.queryFn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws on transport failure so "signed out" is never cached from a 5xx', async () => {
    h.getSession.mockReturnValueOnce(
      Promise.resolve({ data: null, error: { status: 503 } }),
    );
    await expect(sessionQueryOptions.queryFn()).rejects.toThrow(
      'getSession failed with status 503',
    );

    h.getSession.mockReturnValueOnce(
      Promise.resolve({ data: null, error: { status: 0 } }),
    );
    await expect(sessionQueryOptions.queryFn()).rejects.toThrow(
      'getSession failed with status 0',
    );
  });

  it('resolves genuine signed-out (no transport error) as data', async () => {
    const signedOut = { data: null, error: null };
    h.getSession.mockReturnValueOnce(Promise.resolve(signedOut));
    await expect(sessionQueryOptions.queryFn()).resolves.toBe(signedOut);
  });
});
