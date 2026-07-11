// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  token: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { convex: { token: h.token } },
}));

import {
  cacheConvexToken,
  clearConvexTokenCache,
  fetchFreshConvexToken,
  getCachedConvexTokenUserId,
  isTokenUsable,
  readCachedConvexToken,
  takeWarmConvexToken,
  warmConvexToken,
} from './convex-token-cache';

const STORAGE_KEY = 'tale:convex-token';

/** Unsigned JWT with the given payload — the cache never verifies signatures. */
function makeJwt(claims: Record<string, unknown>): string {
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${enc({ alg: 'RS256' })}.${enc(claims)}.sig`;
}

const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  // Drain any warm mint left over from a previous test (module-level state).
  void takeWarmConvexToken();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cacheConvexToken / readCachedConvexToken', () => {
  it('round-trips a valid token with its decoded claims', () => {
    const token = makeJwt({ sessionId: 's1', sub: 'u1', exp: inOneHour() });
    const cached = cacheConvexToken(token);

    expect(cached).toMatchObject({ token, sessionId: 's1', userId: 'u1' });
    expect(readCachedConvexToken()).toEqual(cached);
    expect(getCachedConvexTokenUserId()).toBe('u1');
  });

  it('rejects an expired token and removes it (cold path restored)', () => {
    const token = makeJwt({
      sessionId: 's1',
      sub: 'u1',
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    cacheConvexToken(token);

    expect(readCachedConvexToken()).toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('rejects a token expiring within the pre-auth leeway window', () => {
    const record = cacheConvexToken(
      makeJwt({
        sessionId: 's1',
        sub: 'u1',
        // 10s from now — inside the 30s leeway: too close to survive the
        // WS handshake.
        exp: Math.floor(Date.now() / 1000) + 10,
      }),
    );

    expect(record && isTokenUsable(record)).toBe(false);
    expect(readCachedConvexToken()).toBeNull();
  });

  it('rejects tokens with missing or malformed claims', () => {
    expect(cacheConvexToken(makeJwt({ sub: 'u1', exp: inOneHour() }))).toBe(
      null,
    );
    expect(cacheConvexToken('not-a-jwt')).toBeNull();

    // A malformed value that somehow reached storage is discarded on read.
    window.sessionStorage.setItem(STORAGE_KEY, 'garbage');
    expect(readCachedConvexToken()).toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('clearConvexTokenCache removes the persisted token', () => {
    cacheConvexToken(makeJwt({ sessionId: 's1', sub: 'u1', exp: inOneHour() }));
    clearConvexTokenCache();

    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(getCachedConvexTokenUserId()).toBeUndefined();
  });
});

describe('fetchFreshConvexToken', () => {
  it('persists a freshly minted token', async () => {
    const token = makeJwt({ sessionId: 's2', sub: 'u2', exp: inOneHour() });
    h.token.mockResolvedValueOnce({ data: { token } });

    const record = await fetchFreshConvexToken();

    expect(record?.sessionId).toBe('s2');
    expect(readCachedConvexToken()?.token).toBe(token);
  });

  it('clears the persisted copy when the backend refuses to mint', async () => {
    cacheConvexToken(makeJwt({ sessionId: 's1', sub: 'u1', exp: inOneHour() }));
    h.token.mockResolvedValueOnce({ data: null });

    await expect(fetchFreshConvexToken()).resolves.toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('warmConvexToken / takeWarmConvexToken', () => {
  it('mints once (single-flight) and hands the promise to exactly one consumer', async () => {
    const token = makeJwt({ sessionId: 's3', sub: 'u3', exp: inOneHour() });
    h.token.mockResolvedValue({ data: { token } });

    warmConvexToken();
    warmConvexToken();
    expect(h.token).toHaveBeenCalledTimes(1);

    const warm = takeWarmConvexToken();
    expect(warm).not.toBeNull();
    await expect(warm).resolves.toMatchObject({ token, userId: 'u3' });

    // One-shot: a second consumer must mint anew, never reuse a token that
    // could belong to a previous sign-in.
    expect(takeWarmConvexToken()).toBeNull();
  });
});
