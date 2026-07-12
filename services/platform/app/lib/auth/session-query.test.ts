// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  // Never resolves — proves the token warm is kicked in parallel with (not
  // serially after) the session fetch.
  getSession: vi.fn(() => new Promise(() => {})),
  warmConvexToken: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: h.getSession },
}));
vi.mock('@/app/lib/auth/convex-token-cache', () => ({
  warmConvexToken: h.warmConvexToken,
}));

import { sessionQueryOptions, warmSession } from './session-query';

describe('warmSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('kicks the session fetch and the Convex token warm in parallel', () => {
    warmSession();

    // Both hops start in the same synchronous tick; the session promise is
    // still pending, so the token warm cannot be gated on its result (this is
    // the serial→parallel collapse of epic #2386).
    expect(h.getSession).toHaveBeenCalledTimes(1);
    expect(h.warmConvexToken).toHaveBeenCalledTimes(1);
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
